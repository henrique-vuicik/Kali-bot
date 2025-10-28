// index.js — Kali monta dieta personalizada com questionário curto (conversa livre)

import express from 'express';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;
const D360_API_KEY = process.env.D360_API_KEY?.trim();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY?.trim();
const OPENAI_MODEL = process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini';
const SESSION_TTL_MIN = Number(process.env.SESSION_TTL_MIN || 30);     // sessão expira após X min sem falar
const PLAN_LENGTH_DAYS = Number(process.env.PLAN_LENGTH_DAYS || 3);    // quantos dias de cardápio gerar (3-7 recomendável)

// ---- envio 360 v2 -----------------------------------------------------------
async function sendText(to, body) {
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: String(to),
    type: 'text',
    text: { body: String(body) }
  };
  try {
    const resp = await fetch('https://waba-v2.360dialog.io/messages', {
      method: 'POST',
      headers: {
        'D360-API-KEY': D360_API_KEY,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    const text = await resp.text();
    console.log(`➡️  360 status: ${resp.status} body: ${text}`);
    return { status: resp.status, body: text };
  } catch (err) {
    console.error('❌ 360dialog:', err);
    return { error: String(err) };
  }
}

app.get('/', (_, res) => res.send('✅ Kali Nutro IA (dietas personalizadas)'));

// ---- memória de sessão simples (por número) ---------------------------------
const sessions = new Map();
function getSession(user) {
  const now = Date.now();
  let s = sessions.get(user);
  if (!s || (now - s.last) > SESSION_TTL_MIN * 60_000) {
    s = {
      last: now,
      stage: 'collect',      // 'collect' | 'ready'
      profile: {
        kcal: null,          // alvo calórico diário
        protein_g: null,     // opcional
        meals_per_day: null, // 3-6
        likes: null,         // o que gosta
        dislikes: null,      // o que não curte
        avoid: null,         // alergias/restrições (ex: lactose, glúten, porco)
        cooking_time: null,  // tempo para cozinhar/refeições (ex: 10-15min, marmita)
        budget: null,        // baixo | médio | alto (ou R$)
        wake_sleep: null     // horário (ex: 6h-22h) p/ encaixar lanches
      }
    };
    sessions.set(user, s);
  } else {
    s.last = now;
  }
  return s;
}

// campos obrigatórios mínimos para liberar o plano
const REQUIRED = ['kcal','meals_per_day','likes','dislikes','avoid','cooking_time','budget','wake_sleep'];

function missingFields(profile) {
  return REQUIRED.filter(k => {
    const v = profile[k];
    return v === null || (typeof v === 'string' && v.trim() === '');
  });
}

function quickGreeting(text) {
  const t = text.toLowerCase();
  return ['oi','olá','ola','bom dia','boa tarde','boa noite'].some(s => t.startsWith(s));
}

function looksLikeDietIntent(text) {
  const t = text.toLowerCase();
  return /(dieta|card[aá]pio|plano alimentar|monta.*dieta|planeja.*refei[cç][oõ]es|1500k?cal|1200k?cal|prote[ií]na)/.test(t);
}

// pergunta guiada baseada no próximo campo faltante
function nextQuestion(field) {
  const q = {
    kcal: 'Qual é sua meta calórica diária? (ex: 1500 kcal). Se não sabe, diga objetivo: “emagrecer”, “manter” ou “ganhar massa”.',
    meals_per_day: 'Quantas refeições por dia você prefere? (3, 4, 5 ou 6).',
    likes: 'O que você GOSTA de comer no dia a dia? Cite exemplos (café da manhã, almoço, lanches).',
    dislikes: 'O que NÃO curte ou quer reduzir?',
    avoid: 'Tem alergias, restrições ou algo que precisa EVITAR? (ex: lactose, glúten, porco).',
    cooking_time: 'Quanto tempo costuma ter para preparar/refeição? (ex: 10–15min; marmitas 2x/semana; comer fora).',
    budget: 'Orçamento para alimentação é baixo, médio ou alto? (pode dizer R$ aproximado por dia).',
    wake_sleep: 'Quais seus horários típicos de acordar e dormir? (ex: 6h–22h).'
  };
  return q[field];
}

// formata breve confirmação do perfil coletado
function summarizeProfile(p) {
  return [
    p.kcal ? `• Meta: ${p.kcal}` : null,
    p.protein_g ? `• Proteína: ${p.protein_g} g` : null,
    p.meals_per_day ? `• Refeições/dia: ${p.meals_per_day}` : null,
    p.likes ? `• Gosta: ${p.likes}` : null,
    p.dislikes ? `• Não curte: ${p.dislikes}` : null,
    p.avoid ? `• Evitar: ${p.avoid}` : null,
    p.cooking_time ? `• Tempo: ${p.cooking_time}` : null,
    p.budget ? `• Orçamento: ${p.budget}` : null,
    p.wake_sleep ? `• Rotina: ${p.wake_sleep}` : null
  ].filter(Boolean).join('\n');
}

// tentativa simples de extrair números de kcal e proteína se o usuário digitar solto
function maybeParseNumbers(userText, profile) {
  const kcalMatch = userText.match(/(\d{3,4})\s?k?cal/i);
  if (kcalMatch && !profile.kcal) profile.kcal = `${kcalMatch[1]} kcal`;
  const protMatch = userText.match(/(\d{2,3})\s?g(?:\s?de)?\s?prote[ií]na/i);
  if (protMatch && !profile.protein_g) profile.protein_g = Number(protMatch[1]);
}

// ---- webhook ----------------------------------------------------------------
app.post('/webhook', async (req, res) => {
  try {
    console.log('🟦 Webhook recebido');
    res.status(200).send('OK');

    const msg = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!msg) return;
    const from = msg.from;
    const type = msg.type;
    if (type !== 'text') {
      await sendText(from, 'Recebi! Se puder, me manda em texto o que você precisa 😉');
      return;
    }

    const text = String(msg.text?.body || '').trim();
    console.log(`💬 de ${from}: ${text}`);

    // saudações rápidas
    if (quickGreeting(text)) {
      await sendText(from, 'Oi! Quer que eu monte sua dieta? Me diga objetivo (emagrecer/manter/ganhar massa) ou uma meta kcal 😉');
      return;
    }

    // pega/abre sessão
    const s = getSession(from);
    const p = s.profile;

    // tentativa de extrair kcal/proteína automaticamente
    maybeParseNumbers(text, p);

    // Se usuário pedir dieta ou já estiver no fluxo, coletar > gerar
    if (looksLikeDietIntent(text) || s.stage === 'collect') {
      // heurísticas para preencher campos via linguagem natural (sem NLP pesado)
      const lower = text.toLowerCase();
      if (!p.meals_per_day) {
        const m = lower.match(/(\b[3-6])\s*(refei[cç][oõ]es|x\s?dia)/);
        if (m) p.meals_per_day = Number(m[1]);
      }
      // mapeamento simples para orçamento
      if (!p.budget && /(barato|econ[oô]mico|baixo orçamento|sem gastar)/.test(lower)) p.budget = 'baixo';
      if (!p.budget && /(m[eé]dio)/.test(lower)) p.budget = 'médio';
      if (!p.budget && /(alto|premium)/.test(lower)) p.budget = 'alto';

      // rotular livremente campos textuais se o usuário responder algo logo após a pergunta
      // (estratégia simples: se a última pergunta foi X, salvamos a resposta como p[X])
      if (s.lastAsked && p[s.lastAsked] == null) {
        p[s.lastAsked] = text;
        s.lastAsked = null;
      }

      // ainda faltam dados?
      const missing = missingFields(p);
      if (missing.length > 0) {
        const field = missing[0];
        const q = nextQuestion(field);
        s.lastAsked = field;
        await sendText(from, q);
        return;
      }

      // tudo ok — gerar plano
      s.stage = 'ready';

      // prompt de geração do cardápio
      const sys = `
Você é a **Kali**, assistente de nutrição. Gere um **plano alimentar objetivo** para WhatsApp.
TOM: direto, amigável, sem assinatura. 2–6 linhas por bloco. Use bullets curtos.
OBJETIVO: montar cardápio **${PLAN_LENGTH_DAYS} dias** baseado no perfil abaixo, com foco em adesão.
Inclua: refeições por dia, porção em gramas/medidas caseiras, kcal por refeição, e proteína estimada.
Traga **trocas** rápidas (2-3 por refeição) e **lista de compras** agrupada. Dê 2-3 **dicas práticas** finais.
Respeite restrições, gostos, tempo disponível, orçamento e horários.
Evite termos médicos formais. Não prescreva fármacos. 
Se a meta de proteína não for dada, use 1.6–2.0 g/kg se o usuário mencionar treino; caso contrário 1.2–1.6 g/kg como guia geral (assuma 70–90 kg se o peso não for informado).
`.trim();

      const userProfile = `
Perfil do usuário:
${summarizeProfile(p)}
Refeições por dia: ${p.meals_per_day}
Dias do plano: ${PLAN_LENGTH_DAYS}
`.trim();

      try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: OPENAI_MODEL,
            messages: [
              { role: 'system', content: sys },
              { role: 'user', content: userProfile }
            ],
            temperature: 0.6,
            max_tokens: 900
          })
        });

        if (!response.ok) {
          const errTxt = await response.text();
          console.error('❌ OpenAI:', response.status, errTxt);
          await sendText(from, 'Deu uma travadinha pra gerar o cardápio. Tenta de novo em instantes 🙏');
          return;
        }

        const data = await response.json();
        const plan = data?.choices?.[0]?.message?.content?.trim();
        if (plan) {
          await sendText(from, `Fechei seu perfil 👇\n${summarizeProfile(p)}`);
          // quebra em partes para mensagens longas (limite do WhatsApp ~4-5k chars, mas enviamos em blocos menores)
          const chunks = plan.match(/[\s\S]{1,1200}/g) || [plan];
          for (const part of chunks) {
            await sendText(from, part);
          }
          await sendText(from, 'Se quiser, ajusto por refeição (ex.: “trocar frango por peixe no jantar”) 😉');
        } else {
          await sendText(from, 'Não consegui montar agora. Pode me dizer de novo suas preferências?');
        }
      } catch (e) {
        console.error('💥 OpenAI fatal:', e);
        await sendText(from, 'Falhou a geração do plano. Vamos tentar já já! 🙏');
      }
      return;
    }

    // conversa livre padrão (nutrição/treino/medicações)
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: OPENAI_MODEL,
          messages: [
            {
              role: 'system',
              content: `
Você é a Kali. Estilo WhatsApp, leve e objetivo, sem assinatura.
Foque em nutrição, treino e informações gerais sobre medicações (sem prescrever).
Responda em 2–5 frases, com exemplos práticos e emojis moderados.
`.trim()
            },
            { role: 'user', content: text }
          ],
          temperature: 0.6,
          max_tokens: 260
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ OpenAI:', response.status, errorText);
        await sendText(from, 'Tive um problema com a IA. Tente novamente em instantes 🙏');
        return;
      }
      const data = await response.json();
      const ai = data?.choices?.[0]?.message?.content?.trim();
      await sendText(from, ai || 'Pode repetir em uma frase? 😊');
    } catch (err) {
      console.error('💥 OpenAI:', err);
      await sendText(from, 'Deu uma oscilação aqui. Tenta de novo já já 🙏');
    }

  } catch (err) {
    console.error('🔥 Erro /webhook:', err);
    try { res.status(500).send('erro'); } catch {}
  }
});

// endpoint de teste manual
app.post('/send', async (req, res) => {
  const { to, body } = req.body || {};
  if (!to || !body) return res.status(400).json({ error: 'to e body obrigatórios' });
  const out = await sendText(to, body);
  res.json(out);
});

app.listen(PORT, () => {
  console.log(`🚀 Kali Nutro IA rodando na porta ${PORT}`);
  console.log(`🔔 Endpoint 360: https://waba-v2.360dialog.io/messages`);
  console.log(`🧠 Modelo OpenAI: ${OPENAI_MODEL} | Sessão TTL: ${SESSION_TTL_MIN} min | Plano: ${PLAN_LENGTH_DAYS} dias`);
});
// index.js — Kali Nutro IA (Pro v3)
// - ESM puro (package.json { "type": "module" })
// - 360dialog v2 (mensaging_product obrigatório)
// - Memória por usuário (em memória de processo)
// - Foco rígido em nutrição/treino/suplementação (recusa outros temas)
// - Log de alimentos com subtotal e resumo
// - Identificação apenas quando perguntarem (quem é vc? qual seu nome?)
// - Geração de dieta personalizada (pergunta preferências antes)
// - Modelo: usa o endpoint chat/completions (4o/5-equivalente)

import express from 'express';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;
const D360_API_KEY = process.env.D360_API_KEY?.trim();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY?.trim();

// ====== Memória em processo (por número/wa_id) ======
/*
 state[wa_id] = {
   name: "Kali", // fixo
   day: "YYYY-MM-DD",
   log: [{ whenISO, item, qty, unit, kcal, prot_g, carb_g, fat_g, note }],
   targets: { kcal: 1600, protein_g: 120 }, // opcional
   profile: { likes: [], dislikes: [], restrictions: [], goals: "" }
 }
*/
const state = new Map();

function todayStr() {
  // Data local do container; como é log diário, suficiente.
  return new Date().toISOString().slice(0, 10);
}

function ensureUser(wa_id) {
  const day = todayStr();
  if (!state.has(wa_id)) {
    state.set(wa_id, { name: 'Kali', day, log: [], targets: null, profile: {} });
  }
  const ctx = state.get(wa_id);
  if (ctx.day !== day) { // vira o dia → zera log
    ctx.day = day;
    ctx.log = [];
  }
  return ctx;
}

// ====== Utilidades ======
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
    const txt = await resp.text();
    console.log(`➡️  360 status: ${resp.status} body: ${txt}`);
    return { status: resp.status, body: txt };
  } catch (err) {
    console.error('❌ Erro 360dialog:', err);
    return { error: String(err) };
  }
}

async function askOpenAI(messages, json = false) {
  const body = {
    model: 'gpt-4o', // mapeia para o mais novo disponível na API da sua conta
    messages,
    temperature: 0.2,
    max_tokens: 600
  };
  if (json) body.response_format = { type: 'json_object' };

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`OpenAI ${resp.status}: ${t}`);
  }
  const data = await resp.json();
  return data.choices?.[0]?.message?.content ?? '';
}

// ====== Prompts base ======
const SYSTEM_CORE = `
Você é a *Kali*, assistente do Dr. Henrique (nutrologia).
Tarefa: conversar de forma leve, objetiva e **focada somente** em:
- nutrição, contagem de calorias/macros, composição de alimentos
- treino e gasto energético
- suplementação e medicações relacionadas a emagrecimento/metabolismo (somente orientações gerais, sem prescrever).
NUNCA responda perguntas fora desse escopo; redirecione gentilmente para nutrição/treino/suplementos.

Estilo: curto, claro, amigável, em PT-BR, emojis moderados quando couber. Evite fala robótica.
Quando perguntarem "quem é você", "qual seu nome", "quem é vc", "o que você faz":
  - apresente-se: "Oi! Eu sou a Kali, assistente do Dr. Henrique. Meu nome vem de caloria. Te ajudo a somar calorias do dia, tirar dúvidas e montar planos do seu jeito." 
  - Só faça isso nessas perguntas (não cumprimente com essa apresentação em toda mensagem).

Calorias:
- Se o usuário disser "comi X", estime kcal e macros **porção informada**, use tabela brasileira/padrões médios.
- Se faltar detalhe (gramas, preparo), assuma um padrão comum e avise entre parênteses.
- Sempre que registrar um item, retorne **linha única + subtotal do dia** quando possível (formato abaixo).
- Nunca diga "não entendi, pode repetir?" de forma vazia: em vez disso, peça exatamente o que falta (ex.: "quantos gramas?", "era frito ou cozido?").

Formato de retorno ao registrar alimento (SEM markdown):
• [item formatado]: [kcal] kcal
Subtotal do dia: [soma] kcal
(Diga "resumo" para ver tudo, "zerar" para limpar, ou continue mandando o que comeu.)
`.trim();

const SYSTEM_PARSER = `
Retorne STRICT JSON para o que o usuário comeu, com este formato:
{
  "items": [
    {
      "item": "nome do alimento em PT-BR",
      "qty": number, "unit": "g|ml|un",
      "prep": "assado|cozido|frito|cru|nao_informado",
      "kcal": number,
      "protein_g": number, "carb_g": number, "fat_g": number,
      "note": "observações curtas se assumiu padrão"
    }
  ],
  "intent": "add|resume|reset|diet|identify|chat",
  "missing": "campo que falta (se houver) ou vazio"
}
Regras:
- Se a mensagem for "resumo": intent=resume.
- "zerar", "resetar", "limpar": intent=reset.
- Se pedir dieta/plano: intent=diet.
- Se perguntar nome/quem é você: intent=identify.
- Fora de nutrição/treino/suplementos: intent=chat.
- Para alimentos comuns sem quantidade informada, assuma padrão: 1 un ovo (50g), 1 banana prata (90g), arroz cozido 100g, etc.
- kcal e macros devem ser números (sem texto). Use valores médios realistas.
`.trim();

// ====== Handlers ======
async function handleNutrition(wa_id, text) {
  const ctx = ensureUser(wa_id);

  // Primeira passada: classificar + extrair itens em JSON
  let parsed;
  try {
    const content = await askOpenAI(
      [
        { role: 'system', content: SYSTEM_PARSER },
        { role: 'user', content: text }
      ],
      true
    );
    parsed = JSON.parse(content);
  } catch (e) {
    console.error('Parser falhou:', e.message);
    return `Dei uma travadinha pra entender. Pode me dizer o alimento e a quantidade? (ex: "200 g de frango grelhado")`;
  }

  const intent = parsed.intent || 'chat';

  // 1) Identificação sob demanda
  if (intent === 'identify') {
    return `Oi! Eu sou a Kali, assistente do Dr. Henrique. Meu nome vem de *caloria*. Te ajudo a somar as calorias do dia, tirar dúvidas e montar planos do seu jeito. Quer começar me dizendo o que comeu agora há pouco?`;
  }

  // 2) Resumo
  if (intent === 'resume') {
    if (!ctx.log.length) return `Seu dia está zerado. Me diga o que você comeu que eu vou somando aqui.`;
    const tot = ctx.log.reduce((s, i) => s + (Number(i.kcal) || 0), 0);
    const linhas = ctx.log.map(i => `• ${i.item} (${i.qty}${i.unit}${i.prep && i.prep!=='nao_informado' ? ', '+i.prep : ''}): ${Math.round(i.kcal)} kcal`);
    return `${linhas.join('\n')}\n\nTotal do dia: ${Math.round(tot)} kcal\n(Envie "zerar" para limpar ou continue mandando o que comeu.)`;
  }

  // 3) Reset
  if (intent === 'reset') {
    ctx.log = [];
    return `Prontinho! Zerei seu dia. Manda o próximo alimento que eu já somo.`;
  }

  // 4) Dieta personalizada (perguntas de preferências se ainda não houver perfil)
  if (intent === 'diet') {
    const wants = ctx.profile?.wants;
    if (!wants) {
      ctx.profile.wants = true; // marca que está no fluxo
      return `Fechado! Vamos montar um plano do seu jeito. Me diz rapidinho:\n1) Quantas refeições por dia você prefere?\n2) Tem algo que quer *incluir* (ex: ovo, iogurte, frango, arroz)?\n3) Algo que quer *evitar* ou não come?\n4) Alguma meta (ex: ~1500 kcal e 140 g de proteína)?`;
    }
    // Se já respondeu preferências em mensagens anteriores, delega geração:
    try {
      const plan = await askOpenAI([
        { role: 'system', content: SYSTEM_CORE },
        { role: 'user', content: `Baseado nas preferências do usuário (mensagens anteriores) gere um cardápio de 1 dia com porções em gramas/ml e macros aproximadas por refeição, e total diário.` }
      ]);
      return plan;
    } catch (e) {
      return `Tentei montar o plano mas deu erro momentâneo. Me manda suas preferências e metas em uma mensagem só, que eu gero em seguida.`;
    }
  }

  // 5) Chat dentro do escopo (nutrição/treino/suplementação)
  if (intent === 'chat' && !(parsed.items?.length)) {
    // Responder curto e focado
    try {
      const reply = await askOpenAI([
        { role: 'system', content: SYSTEM_CORE },
        { role: 'user', content: text }
      ]);
      return reply;
    } catch (e) {
      return `Posso te ajudar com nutrição, treino e suplementação. Quer falar sobre sua alimentação de hoje?`;
    }
  }

  // 6) Adicionar itens (somar)
  if (parsed.items?.length) {
    let added = [];
    for (const it of parsed.items) {
      const rec = {
        whenISO: new Date().toISOString(),
        item: it.item,
        qty: Number(it.qty) || 1,
        unit: it.unit || 'un',
        prep: it.prep || 'nao_informado',
        kcal: Number(it.kcal) || 0,
        protein_g: Number(it.protein_g) || 0,
        carb_g: Number(it.carb_g) || 0,
        fat_g: Number(it.fat_g) || 0,
        note: it.note || ''
      };
      ctx.log.push(rec);
      added.push(`• ${rec.item} (${rec.qty}${rec.unit}${rec.prep && rec.prep!=='nao_informado' ? ', '+rec.prep : ''}): ${Math.round(rec.kcal)} kcal`);
    }
    const subtotal = ctx.log.reduce((s, i) => s + (Number(i.kcal) || 0), 0);
    return `${added.join('\n')}\n\nSubtotal do dia: ${Math.round(subtotal)} kcal\n(Diga "resumo" para ver tudo, "zerar" para limpar, ou continue mandando o que comeu.)`;
  }

  // 7) Fallback
  return `Me conta o alimento e a quantidade (ex: "150 g de frango grelhado" ou "1 banana"). Eu já somo por aqui.`;
}

// ====== Rotas ======
app.get('/', (_req, res) => {
  res.send('✅ Kali Nutro IA Pro v3 online');
});

app.post('/webhook', async (req, res) => {
  try {
    console.log('🟦 Webhook recebido');
    console.log('↩️ body:', JSON.stringify(req.body));
    res.status(200).send('OK'); // responde rápido

    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const messages = value?.messages;
    if (!messages || !Array.isArray(messages)) {
      console.log('⚠️ Sem mensagens processáveis');
      return;
    }

    for (const msg of messages) {
      const from = msg.from;
      const type = msg.type;
      console.log(`💬 de ${from}: tipo=${type}`);

      if (type !== 'text' || !msg.text?.body) {
        await sendText(from, 'Pode me mandar por texto? Assim eu somo direitinho as calorias. 😊');
        continue;
      }

      const text = String(msg.text.body || '').trim();

      // Hard-guard contra assuntos fora do escopo (ex.: “quem descobriu o Brasil?”)
      const offTopicRegex = /(quem descobriu|porsche|carro mais rápido|cotação|política|história do brasil|futebol|tempo em )/i;
      if (offTopicRegex.test(text)) {
        await sendText(from, 'Eu fico só no time da nutrição, treino e suplementação 😉. Quer falar do que você comeu agora ou tirar uma dúvida de alimentos?');
        continue;
      }

      // Identificação sob demanda (atajos simples)
      const identRegex = /(quem é você|quem é vc|qual seu nome|quem é a kali)/i;
      if (identRegex.test(text)) {
        await sendText(from, 'Oi! Eu sou a Kali, assistente do Dr. Henrique. Meu nome vem de *caloria*. Te ajudo a somar as calorias do dia, tirar dúvidas e montar planos do seu jeito. Quer começar me dizendo o que comeu agora há pouco?');
        continue;
      }

      // Núcleo de nutrição
      let reply;
      try {
        reply = await handleNutrition(from, text);
      } catch (e) {
        console.error('Erro handleNutrition:', e);
        reply = 'Deu uma oscilada por aqui. Me manda de novo o alimento e a quantidade que eu já somo. 🙏';
      }
      await sendText(from, reply);
    }
  } catch (err) {
    console.error('🔥 Erro no /webhook:', err);
    try { res.status(500).send('erro'); } catch {}
  }
});

// Envio manual para teste
app.post('/send', async (req, res) => {
  const { to, body } = req.body || {};
  if (!to || !body) return res.status(400).json({ error: 'to e body obrigatórios' });
  try {
    const r = await sendText(to, body);
    res.json(r);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Kali Nutro IA Pro v3 rodando na porta ${PORT}`);
  console.log(`🔔 Endpoint 360: https://waba-v2.360dialog.io/messages`);
  if (!D360_API_KEY) console.warn('⚠️ D360_API_KEY não configurado');
  if (!OPENAI_API_KEY) console.warn('⚠️ OPENAI_API_KEY não configurado');
});
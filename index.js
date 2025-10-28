// index.js — Kali Nutro IA (com memória por usuário e apresentação única)

import express from 'express';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;
const D360_API_KEY = process.env.D360_API_KEY?.trim();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY?.trim();
const OPENAI_MODEL = process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini';

// ---------------------------------------------------------------------------
// 🌟 MEMÓRIA POR USUÁRIO (em RAM)
const users = new Map();
function getUser(waId) {
  if (!users.has(waId)) {
    users.set(waId, {
      introduced: false, // se já apresentou a Kali
      profile: {
        objetivo: null,
        kcalMeta: null,
        proteinaMeta: null,
        gosta: [],
        naoGosta: [],
        alergias: []
      },
      lastSeen: Date.now()
    });
  }
  return users.get(waId);
}

// ---------------------------------------------------------------------------
// 💬 TEXTOS E DETECTORES

const KALI_INTRO = `Oi! Eu sou a **Kali**, assistente do Dr. Henrique. 💫
Meu nome vem de *caloria*! Fui criada pra te ajudar nessa jornada — somar as calorias do dia, tirar dúvidas sobre nutrição, treino e medicações, e montar planos alimentares do seu jeito. 🙂`;

function quickGreeting(t) {
  return /^\s*(oi|ol[aá]|bom dia|boa tarde|boa noite)\b/i.test(t || '');
}

function isIdentityQuestion(text) {
  const t = (text || '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
  return /(quem e voce|quem e vc|qual seu nome|seu nome|o que voce faz|kali\??|assistente\??)/.test(t);
}

function querDieta(t) {
  return /(dieta|card[aá]pio|plano alimentar|cardapio)/i.test(t || '');
}

function extrairNumeroG(t) {
  const m = (t || '').match(/(\d+)\s*g/);
  return m ? Number(m[1]) : null;
}

function extrairNumeroKcal(t) {
  const m = (t || '').match(/(\d+)\s*k?cal/i);
  return m ? Number(m[1]) : null;
}

// ---------------------------------------------------------------------------
// 📤 ENVIO VIA 360DIALOG
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
  } catch (err) {
    console.error('❌ 360dialog:', err);
  }
}

// ---------------------------------------------------------------------------
// 🧠 OPENAI CHAT
async function chatOpenAI(prompt, perfil) {
  const body = {
    model: OPENAI_MODEL,
    temperature: 0.6,
    max_tokens: 500,
    messages: [
      {
        role: 'system',
        content: `
Você é a Kali, assistente do Dr. Henrique (nutrologia). 
TOM: leve, direto, simpático e sem formalidade. 
Não assine. Responda como se fosse uma conversa no WhatsApp.
Perfil do paciente: ${JSON.stringify(perfil)}
`.trim()
      },
      { role: 'user', content: prompt }
    ]
  };

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const data = await response.json();
  return data?.choices?.[0]?.message?.content?.trim() || '🤔 Não consegui entender direito.';
}

// ---------------------------------------------------------------------------
// 🚑 WEBHOOK
app.post('/webhook', async (req, res) => {
  try {
    res.status(200).send('OK');
    console.log('🟦 Webhook recebido');
    const msg = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!msg) return;

    const from = msg.from;
    const type = msg.type;
    if (type !== 'text') return;

    const text = (msg.text?.body || '').trim();
    console.log(`💬 de ${from}: ${text}`);

    const user = getUser(from);
    const perfil = user.profile;

    // Apresentação: só no 1º contato ou se perguntarem
    if ((quickGreeting(text) && !user.introduced) || isIdentityQuestion(text)) {
      await sendText(from, KALI_INTRO);
      user.introduced = true;
      return;
    }

    // --- fluxo de construção de dieta ---
    if (querDieta(text)) {
      if (!perfil.objetivo) {
        await sendText(from, 'Qual seu objetivo agora? (emagrecer, manter ou ganhar massa)');
        perfil.objetivo = text.toLowerCase();
        return;
      }

      if (!perfil.kcalMeta) {
        const kcal = extrairNumeroKcal(text);
        if (!kcal) {
          await sendText(from, 'Quantas kcal por dia você quer? (ex: 1600 kcal)');
          return;
        }
        perfil.kcalMeta = kcal;
      }

      if (!perfil.proteinaMeta) {
        const g = extrairNumeroG(text);
        if (!g) {
          await sendText(from, 'Tem alguma meta de proteína? (ex: 150 g por dia)');
          return;
        }
        perfil.proteinaMeta = g;
      }

      if (!perfil.gosta.length) {
        await sendText(from, 'Me diga 3 a 5 alimentos que você gosta e costuma comer no dia a dia. 🍽️');
        perfil.gosta.push(text);
        return;
      }

      await sendText(from, 'Perfeito! Montando um plano personalizado pra você... 💪');

      const prompt = `
Monte um cardápio de 1 dia (café, almoço, lanche, jantar) com base nestes dados:
Objetivo: ${perfil.objetivo}
Kcal: ${perfil.kcalMeta}
Proteína: ${perfil.proteinaMeta}g
Gosta: ${perfil.gosta.join(', ')}
Não gosta: ${perfil.naoGosta.join(', ')}
Alergias: ${perfil.alergias.join(', ')}
Traga quantidades aproximadas e alternativas rápidas.
`.trim();

      const plan = await chatOpenAI(prompt, perfil);
      await sendText(from, plan);
      return;
    }

    // --- conversa livre ---
    if (isIdentityQuestion(text)) {
      await sendText(from, KALI_INTRO);
      return;
    }

    const answer = await chatOpenAI(text, perfil);
    await sendText(from, answer);

  } catch (err) {
    console.error('🔥 Erro webhook:', err);
    try { res.status(500).send('erro'); } catch {}
  }
});

// ---------------------------------------------------------------------------
// 📡 TESTE MANUAL
app.post('/send', async (req, res) => {
  const { to, body } = req.body || {};
  if (!to || !body) return res.status(400).json({ error: 'to e body obrigatórios' });
  await sendText(to, body);
  res.send('ok');
});

// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`🚀 Kali Nutro IA rodando na porta ${PORT}`);
  console.log(`🧠 Modelo OpenAI: ${OPENAI_MODEL}`);
});
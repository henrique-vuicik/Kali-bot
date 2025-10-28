// index.js — Kali Nutro IA (calorias inteligentes + memória por usuário)

import express from 'express';
import dotenv from 'dotenv';
dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;
const D360_API_KEY = process.env.D360_API_KEY?.trim();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY?.trim();
const OPENAI_MODEL = process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini';

/* =========================
   MEMÓRIA POR USUÁRIO (RAM)
   ========================= */
const users = new Map();
function getUser(waId) {
  if (!users.has(waId)) {
    users.set(waId, {
      introduced: false,
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

/* ==============================
   TEXTOS, DETECTORES E HELPERS
   ============================== */
const KALI_INTRO = `Oi! Eu sou a *Kali*, assistente do Dr. Henrique. ✨
Meu nome vem de *caloria*! Tô aqui pra somar suas calorias do dia, tirar dúvidas de nutrição/treino/medicações e montar planos do seu jeito. 🙂`;

function norm(s='') { return s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu,''); }
function quickGreeting(t) { return /^\s*(oi|ola|ol[aá]|bom dia|boa tarde|boa noite)\b/i.test(t||''); }
function isIdentityQuestion(text) {
  const t = norm(text);
  return /(quem e voce|quem e vc|qual seu nome|seu nome|o que voce faz|kali\??|assistente\??)/.test(t);
}
function querDieta(t){ return /(dieta|cardapio|card[aá]pio|plano alimentar)/i.test(t||''); }
function extrairNumeroG(t){ const m=(t||'').match(/(\d+)\s*g\b/i); return m?Number(m[1]):null; }
function extrairNumeroKcal(t){ const m=(t||'').match(/(\d+)\s*k?cal\b/i); return m?Number(m[1]):null; }
function extrairUnidades(t){ const m=(t||'').match(/(\d+)\s*(un|unid|unidade|fatias?|peda[cç]os?)/i); return m?Number(m[1]):null; }
function extrairML(t){ const m=(t||'').match(/(\d+)\s*ml\b/i); return m?Number(m[1]):null; }

/* ============================================
   MINI BANCO DE DADOS DE ALIMENTOS (BR) — base
   kcal_por_100g e médias de porção padrão
   ============================================ */
const FOOD_DB = {
  // densidades (g/ml) aproximadas
  _density: {
    'agua': 1.0,
    'suco': 1.0,
    'salada de frutas': 0.90,
    'iogurte': 1.05,
    'sopa': 1.02
  },
  // kcal por 100g (médias brasileiras)
  'salada de frutas': { kcal100: 55, notes: 'Sem calda/açúcar. Com mel/calda pode subir ~20–40%.' },
  'arroz cozido':     { kcal100: 128 },
  'feijao cozido':    { kcal100: 76 },
  'frango grelhado':  { kcal100: 165, prot100: 31 },
  'ovo cozido':       { kcal100: 155, prot100: 13 },
  'banana prata':     { kcal100: 95, porcao: { unidade: 80 } },  // 1 un ~80g
  'maca':             { kcal100: 52, porcao: { unidade: 130 } },
  'paes: pao frances':{ kcal100: 270, porcao: { unidade: 50 } }, // 1 pão ~50g
  'pao frances':      { kcal100: 270, porcao: { unidade: 50 } },
  'pastel de carne':  { faixa: [260, 420], porcao: { unidade: 120 }, notes: 'Varia por tamanho e óleo da fritura.' },
  'coxinha':          { faixa: [180, 350], porcao: { unidade: 100 } },
  'pizza mussarela':  { faixaFatias: [230, 320], notes: 'Por fatia média (1/8 de 35cm).' },
  'pizza calabresa':  { faixaFatias: [250, 340] },
  'iogurte natural':  { kcal100: 65, dens: 'iogurte' },
  'leite integral':   { kcal100: 61, dens: 'agua' }
};

/* ===================================================
   PARSER DE ITENS + ESTIMADOR DE CALORIAS (ml/g/un)
   =================================================== */
function guessFoodKey(text){
  const t = norm(text);
  const keys = Object.keys(FOOD_DB).filter(k=>!k.startsWith('_'));
  // tenta match direto
  for (const k of keys){ if (t.includes(norm(k))) return k; }
  // sinônimos comuns
  if (t.includes('salada de fruta')) return 'salada de frutas';
  if (t.includes('arroz')) return 'arroz cozido';
  if (t.includes('feijao')) return 'feijao cozido';
  if (t.includes('frango')) return 'frango grelhado';
  if (t.includes('ovo')) return 'ovo cozido';
  if (t.includes('banana')) return 'banana prata';
  if (t.includes('maca')) return 'maca';
  if (t.includes('pao frances') || t.includes('pao ')) return 'pao frances';
  if (t.includes('pastel')) return 'pastel de carne';
  if (t.includes('coxinha')) return 'coxinha';
  if (t.includes('pizza') && t.includes('muss')) return 'pizza mussarela';
  if (t.includes('pizza') && t.includes('calab')) return 'pizza calabresa';
  if (t.includes('iogurte')) return 'iogurte natural';
  if (t.includes('leite')) return 'leite integral';
  return null;
}

function mlToGr(key, ml){
  // densidade específica se houver
  const item = FOOD_DB[key];
  let densKey = item?.dens || key;
  const dens = FOOD_DB._density[densKey] ?? 1.0;
  return Math.round(ml * dens);
}

function formatKcal(k){
  return `${Math.round(k)} kcal`;
}

function estimateCalories(text){
  const key = guessFoodKey(text);
  if (!key) return null;

  const item = FOOD_DB[key];
  const ml = extrairML(text);
  const g  = extrairNumeroG(text);
  const un = extrairUnidades(text);

  // pizza por fatia
  if (item.faixaFatias) {
    const q = un || 1;
    const [min,max] = item.faixaFatias;
    return {
      title: `${q} fatia(s) de ${key}`,
      kcalText: `${formatKcal(q*min)} ~ ${formatKcal(q*max)}`,
      notes: item.notes || 'Varia com tamanho e cobertura.'
    };
  }

  // por unidade com faixa (pastel/coxinha)
  if (item.faixa && item.porcao?.unidade) {
    const q = un || 1;
    const [min,max] = item.faixa;
    return {
      title: `${q} un de ${key}`,
      kcalText: `${formatKcal(q*min)} ~ ${formatKcal(q*max)}`,
      notes: item.notes || 'Receitas e tamanhos variam.'
    };
  }

  // com volume declarado
  if (ml) {
    const grams = mlToGr(key, ml);
    if (item.kcal100){
      const kcal = grams * item.kcal100 / 100;
      return {
        title: `${ml} ml de ${key} (~${grams} g)`,
        kcalText: formatKcal(kcal),
        notes: item.notes || null
      };
    }
  }

  // com gramas declarados
  if (g) {
    if (item.kcal100){
      const kcal = g * item.kcal100 / 100;
      return {
        title: `${g} g de ${key}`,
        kcalText: formatKcal(kcal),
        notes: item.notes || null
      };
    }
  }

  // por unidade simples
  if (un && item.porcao?.unidade && item.kcal100){
    const grams = un * item.porcao.unidade;
    const kcal = grams * item.kcal100 / 100;
    return {
      title: `${un} un de ${key} (~${grams} g)`,
      kcalText: formatKcal(kcal),
      notes: item.notes || null
    };
  }

  // 1 unidade default se houver porção
  if (item.porcao?.unidade && item.kcal100){
    const grams = item.porcao.unidade;
    const kcal = grams * item.kcal100 / 100;
    return {
      title: `1 un de ${key} (~${grams} g)`,
      kcalText: formatKcal(kcal),
      notes: item.notes || null
    };
  }

  return null;
}

/* ===========================
   ENVIO VIA 360DIALOG v2
   =========================== */
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

/* ===========================
   OPENAI (fallback conversa)
   =========================== */
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
TOM: leve, direto, simpático, objetivo e sem assinatura.
Responda como WhatsApp, frases curtas quando possível.
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
  return data?.choices?.[0]?.message?.content?.trim() || 'Não peguei. Pode reformular rapidinho?';
}

/* ================
   HEALTH CHECK
   ================ */
app.get('/', (_, res) => res.send('✅ Kali Nutro IA online'));

/* ================
   WEBHOOK 360
   ================ */
app.post('/webhook', async (req, res) => {
  try {
    res.status(200).send('OK');
    const value = req.body?.entry?.[0]?.changes?.[0]?.value;
    const msg = value?.messages?.[0];
    if (!msg || msg.type !== 'text') return;

    const from = msg.from;
    const text = (msg.text?.body || '').trim();
    console.log(`💬 ${from}: ${text}`);

    const user = getUser(from);
    const perfil = user.profile;

    // apresentação: só 1ª vez ou se perguntarem
    if ((quickGreeting(text) && !user.introduced) || isIdentityQuestion(text)) {
      await sendText(from, KALI_INTRO);
      user.introduced = true;
      return;
    }

    // modo DIETA personalizada
    if (querDieta(text)) {
      if (!perfil.objetivo) { perfil.objetivo = null; await sendText(from,'Qual seu objetivo agora? (emagrecer, manter, ganhar massa)'); return; }
      if (!perfil.kcalMeta) { const kcal=extrairNumeroKcal(text); if(!kcal){ await sendText(from,'Quantas kcal por dia? (ex: 1600 kcal)'); return;} perfil.kcalMeta=kcal; }
      if (!perfil.proteinaMeta){ const g=extrairNumeroG(text); if(!g){ await sendText(from,'Meta de proteína? (ex: 150 g/dia)'); return;} perfil.proteinaMeta=g; }
      if (!perfil.gosta.length){ perfil.gosta.push(text); await sendText(from,'Me diga 3–5 alimentos que você gosta e costuma comer.'); return; }

      await sendText(from,'Fechado! Vou montar um dia de cardápio pra você…');
      const prompt = `Monte um cardápio de 1 dia (café, almoço, lanche, jantar) com base:
Objetivo: ${perfil.objetivo}
Kcal: ${perfil.kcalMeta}
Proteína: ${perfil.proteinaMeta}g
Gosta: ${perfil.gosta.join(', ')}
Evitar: ${perfil.naoGosta.join(', ')}
Alergias: ${perfil.alergias.join(', ')}
Traga quantidades e alternativas rápidas de mercado.`;
      const plan = await chatOpenAI(prompt, perfil);
      await sendText(from, plan);
      return;
    }

    // PRIMEIRO: tentar estimar calorias localmente
    const est = estimateCalories(text);
    if (est) {
      let msgOut = `≈ ${est.kcalText} — ${est.title}`;
      if (est.notes) msgOut += `\nObs.: ${est.notes}`;
      // dica extra inteligente
      if (norm(est.title).includes('salada de frutas')) {
        msgOut += `\nQuer que eu some no seu dia? Me diga também o que mais comeu.`;
      }
      await sendText(from, msgOut);
      return;
    }

    // FALLBACK: conversa livre
    const answer = await chatOpenAI(text, perfil);
    await sendText(from, answer);

  } catch (err) {
    console.error('🔥 Webhook error:', err);
    try { res.status(500).send('erro'); } catch {}
  }
});

/* ==================
   ENVIO MANUAL /send
   ================== */
app.post('/send', async (req, res) => {
  const { to, body } = req.body || {};
  if (!to || !body) return res.status(400).json({ error: 'to e body obrigatórios' });
  await sendText(to, body);
  res.send('ok');
});

/* ========
   LISTEN
   ======== */
app.listen(PORT, () => {
  console.log(`🚀 Kali Nutro IA rodando na porta ${PORT}`);
  console.log(`🧠 Modelo OpenAI: ${OPENAI_MODEL}`);
});
// index.js — Kali Nutro IA (360dialog only)
// Node 18+ (fetch nativo). CommonJS.

const express = require('express');
const app = express();

app.use(express.json({ limit: '5mb' }));

// ======== ENV =========
const PORT = process.env.PORT || 8080;
const BASE_URL = process.env.WABA_BASE_URL || 'https://waba-v2.360dialog.io';
const D360_API_KEY = process.env.D360_API_KEY;     // obrigatória
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'kali-verify';

// ======== LOG BOOT ========
console.log('\x1b[34m%s\x1b[0m', `🔔 Endpoint primário: ${BASE_URL}/v1/messages`);
console.log('\x1b[32m%s\x1b[0m', `🟩 🚀 Kali Nutro IA rodando na porta ${PORT}`);
if (!D360_API_KEY) {
  console.warn('\x1b[33m%s\x1b[0m', '⚠️  D360_API_KEY não configurada — env no Railway é obrigatório.');
}

// ======== HELPERS 360 ========
async function sendText360(to, body) {
  const url = `${BASE_URL}/v1/messages`;
  const payload = {
    to: String(to),
    type: 'text',
    text: { body: String(body).slice(0, 4000), preview_url: false }
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'D360-API-KEY': D360_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const text = await res.text().catch(() => '');
  if (!res.ok) {
    console.error('Falha v1/messages', res.status, 'Payload:', JSON.stringify(payload), 'Resposta:', text);
    throw new Error(`Falha v1/messages ${res.status}: ${text || 'sem corpo'}`);
  }
  return safeJson(text);
}

async function downloadMedia360(mediaId) {
  const url = `${BASE_URL}/v1/media/${encodeURIComponent(mediaId)}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { 'D360-API-KEY': D360_API_KEY }
  });
  if (!res.ok) {
    const errTxt = await res.text().catch(() => '');
    console.error('\x1b[31m%s\x1b[0m', 'Falha 360 ao baixar mídia:', errTxt || res.statusText);
    throw new Error('media_not_found');
  }
  const contentType = res.headers.get('content-type') || '';
  const buffer = Buffer.from(await res.arrayBuffer());
  return { buffer, contentType };
}

function safeJson(txt) {
  try { return JSON.parse(txt); } catch { return { raw: txt }; }
}

// ======== NUTRO DUMMY (texto) ========
// Parser simples só para garantir resposta enquanto a IA/visão não roda.
function estimateCaloriesFromText(text) {
  // Exemplo ridiculamente simples para não travar o fluxo.
  const db = [
    { k: /banana/i, kcal: 90, label: 'Banana (1 un média)' },
    { k: /p(ã|a)o (franc[eê]s|frances)/i, kcal: 140, label: 'Pão francês (1 un)' },
    { k: /ovo/i, kcal: 70, label: 'Ovo (1 un cozido)' },
    { k: /cafe/i, kcal: 2, label: 'Café preto (1 xícara)' },
    { k: /arroz/i, kcal: 170, label: 'Arroz cozido (1 xícara)' },
    { k: /frango/i, kcal: 200, label: 'Frango grelhado (150g)' },
  ];
  const items = [];
  let total = 0;
  for (const it of db) {
    if (it.k.test(text)) {
      items.push({ label: it.label, kcal: it.kcal });
      total += it.kcal;
    }
  }
  return { items, total };
}

// ======== WEBHOOK VERIFY (GET) ========
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// ======== WEBHOOK RECEIVER (POST) ========
app.post('/webhook', async (req, res) => {
  // Sempre responde 200 rápido para não tomar retry em loop
  res.sendStatus(200);

  try {
    console.log('\x1b[34m%s\x1b[0m', '🟦 Webhook recebido');

    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    // Ignore status callbacks
    if (value?.statuses) return;

    const msg = value?.messages?.[0];
    if (!msg) return;

    const from = msg.from; // WhatsApp ID do remetente
    const type = msg.type;

    if (type === 'text') {
      const text = msg.text?.body || '';
      const { items, total } = estimateCaloriesFromText(text);

      let reply;
      if (items.length === 0) {
        reply = 'Me conte o que você comeu (ex.: "2 fatias de pão, 1 ovo e café") que eu estimo as calorias. 📋';
      } else {
        const linhas = items.map(i => `• ${i.label}: ${i.kcal} kcal`).join('\n');
        reply = `Itens:\n${linhas}\nTotal: ${total} kcal\nDica: Posso registrar o dia todo — me envie o resto das refeições.`;
      }

      try {
        await sendText360(from, reply);
      } catch (e) {
        console.error('\x1b[31m%s\x1b[0m', 'Falha ao enviar WhatsApp:', e.message || e);
      }
      return;
    }

    if (type === 'image') {
      // Pega o mediaId do payload da 360 (NÃO confundir com Cloud API)
      const mediaId = msg.image?.id;
      if (!mediaId) {
        await sendText360(from, 'Não consegui ler a imagem. Pode reenviar? 🙏');
        return;
      }

      try {
        const media = await downloadMedia360(mediaId);
        // Aqui você chamaria sua IA de visão para estimar calorias pela imagem.
        // Por enquanto, responde só para validar o fluxo:
        await sendText360(from, 'Recebi sua foto! Vou treinar minha visão para estimar as calorias do prato. 🧠🍽️');
      } catch (e) {
        console.error('\x1b[31m%s\x1b[0m', 'Falha fluxo imagem:', e.message || e);
        await sendText360(from, 'Tive um problema ao baixar/analisar a foto. Pode tentar novamente? 🙏');
      }
      return;
    }

    // Outros tipos
    await sendText360(from, 'Me envie texto com a refeição ou uma foto do prato que eu ajudo nas calorias. 😊');

  } catch (err) {
    console.error('\x1b[31m%s\x1b[0m', 'Erro no webhook:', err?.message || err);
  }
});

// ======== HEALTH =========
app.get('/', (_, res) => res.send('Kali Nutro IA (360dialog) OK'));

app.listen(PORT);
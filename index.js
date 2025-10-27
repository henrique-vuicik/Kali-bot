// index.js (CommonJS) — Node 18+ tem fetch nativo
require('dotenv').config();
const express = require('express');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;
const D360_ENDPOINT = 'https://waba-v2.360dialog.io/v1/messages';
const D360_API_KEY = process.env.D360_API_KEY;

// Envia texto pelo 360dialog
async function sendText(to, body) {
  const payload = {
    messaging_product: 'whatsapp',
    to: String(to), // ex: 55429....
    type: 'text',
    text: { body: String(body) }
  };

  const resp = await fetch(D360_ENDPOINT, {
    method: 'POST',
    headers: {
      'D360-API-KEY': D360_API_KEY,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const respText = await resp.text();
  console.log(`➡️  360 status: ${resp.status} body: ${respText}`);
  return { status: resp.status, body: respText };
}

// Healthcheck simples
app.get('/', (_req, res) => res.send('🚀 Kali Nutro IA rodando'));

// Opcional: GET /webhook só para ping/monitor (360 usa POST)
app.get('/webhook', (_req, res) => res.sendStatus(200));

// Webhook de entrada do 360
app.post('/webhook', async (req, res) => {
  console.log('🟦 Webhook recebido');
  console.log('↩️ body:', JSON.stringify(req.body));

  try {
    const msg = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    const from = msg?.from;
    const type = msg?.type;

    if (type === 'text') {
      const userText = msg.text?.body ?? '';
      console.log(`💬 de ${from}: ${userText}`);
      // Resposta simples (eco)
      await sendText(from, `Recebi: ${userText} ✅`);
    } else {
      console.log('ℹ️ Mensagem não-texto (ignorada neste MVP).');
    }

    // SEMPRE 200 rapidamente para não reentregar
    res.sendStatus(200);
  } catch (err) {
    console.error('🔥 Erro no webhook:', err);
    // Ainda responder 200 para evitar reentrega em loop
    res.sendStatus(200);
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Kali Nutro IA estável rodando na porta ${PORT}`);
  console.log(`🔔 Endpoint 360: ${D360_ENDPOINT}`);
});
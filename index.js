// index.js — Kali Nutro IA (estável)
// Compatível com Node 18+ no Railway
// Modo CommonJS (sem "type": "module")

require('dotenv').config();
const express = require('express');
const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

const app = express();
app.use(express.json());

// Configurações principais
const PORT = process.env.PORT || 8080;
const D360_ENDPOINT = 'https://waba-v2.360dialog.io/v1/messages';
const D360_API_KEY = process.env.D360_API_KEY;

// Função para enviar texto pelo 360dialog
async function sendText(to, message) {
  try {
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: String(to),
      type: 'text',
      text: { body: String(message) }
    };

    const response = await fetch(D360_ENDPOINT, {
      method: 'POST',
      headers: {
        'D360-API-KEY': D360_API_KEY,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const result = await response.text();
    console.log(`➡️  360 status: ${response.status} body: ${result}`);
  } catch (err) {
    console.error('🔥 Erro ao enviar mensagem 360:', err);
  }
}

// Webhook para receber mensagens do WhatsApp
app.post('/webhook', async (req, res) => {
  console.log('🟦 Webhook recebido');
  console.log('↩️ body:', JSON.stringify(req.body));

  try {
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const message = value?.messages?.[0];

    if (message && message.type === 'text') {
      const from = message.from;
      const userText = message.text.body;
      console.log(`💬 Mensagem recebida de ${from}: ${userText}`);

      // Resposta automática
      await sendText(from, `Recebi: ${userText} ✅`);
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('🔥 Erro no webhook:', err);
    res.sendStatus(500);
  }
});

// Endpoint de verificação (para debug/teste)
app.get('/', (req, res) => {
  res.send('🚀 Kali Nutro IA rodando com sucesso!');
});

// Inicializa o servidor
app.listen(PORT, () => {
  console.log(`🚀 Kali Nutro IA estável rodando na porta ${PORT}`);
  console.log(`🔔 Endpoint 360: ${D360_ENDPOINT}`);
});
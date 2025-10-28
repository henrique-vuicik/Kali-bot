// index.js — ES Module
import express from 'express';
import dotenv from 'dotenv';
import process from 'process';

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;
const D360_API_KEY = process.env.D360_API_KEY; // Numbers -> Show API Key

if (!D360_API_KEY) {
  console.warn('⚠️ D360_API_KEY não configurado — configure no Railway / env vars');
}

/**
 * Envia texto via 360dialog v2
 * Payload (v2) precisa do campo messaging_product: "whatsapp"
 */
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

    const respText = await resp.text();
    console.log(`➡️  360 status: ${resp.status} body: ${respText}`);
    return { status: resp.status, body: respText };
  } catch (err) {
    console.error('Erro ao chamar 360dialog:', err);
    throw err;
  }
}

// Health
app.get('/', (_req, res) => {
  res.send('Kali Nutro IA estável');
});

// Webhook (WABA -> seu servidor)
app.post('/webhook', async (req, res) => {
  try {
    console.log('🟦 Webhook recebido');
    console.log('↩️ body:', JSON.stringify(req.body));
    res.status(200).send('OK'); // responde rápido pro WABA não reenviar

    const entry = req.body?.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const messages = value?.messages;

    if (!messages || !Array.isArray(messages)) {
      console.log('Nenhuma mensagem processável encontrada no webhook.');
      return;
    }

    for (const msg of messages) {
      try {
        const from = msg.from;
        const type = msg.type;
        console.log(`💬 de ${from}: tipo=${type}`);

        if (type === 'text' && msg.text?.body) {
          const received = msg.text.body;
          console.log(`📥 recebido: ${received}`);
          await sendText(from, `Recebi: ${received} ✅`);
        } else {
          await sendText(from, 'Recebi sua mensagem. Obrigado!');
        }
      } catch (innerErr) {
        console.error('Erro ao processar mensagem individual:', innerErr);
      }
    }
  } catch (err) {
    console.error('Erro no endpoint /webhook:', err);
    try { res.status(500).send('erro'); } catch {}
  }
});

// Endpoint opcional para teste manual
// POST /send { "to": "55429...", "body": "texto" }
app.post('/send', async (req, res) => {
  const { to, body } = req.body || {};
  if (!to || !body) return res.status(400).json({ error: 'to e body obrigatórios' });

  try {
    const resp = await sendText(to, body);
    res.json(resp);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Kali Nutro IA estável rodando na porta ${PORT}`);
  console.log(`🔔 Endpoint 360: https://waba-v2.360dialog.io/messages`);
});
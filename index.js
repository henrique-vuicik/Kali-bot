// index.js — ES Module
import express from 'express';
import dotenv from 'dotenv';
import process from 'process';
import { aiReply } from './brain.js';

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;
const D360_API_KEY = process.env.D360_API_KEY; // Numbers → Show API Key

if (!D360_API_KEY) {
  console.warn('⚠️ D360_API_KEY não configurado — defina nas env vars do Railway');
}

// --- 360dialog: envio de texto (v2, sem messaging_product) ---
async function sendText(to, body) {
  const payload = {
    recipient_type: 'individual',
    to: String(to),
    type: 'text',
    text: { body: String(body) }
  };

  const resp = await fetch('https://waba-v2.360dialog.io/messages', {
    method: 'POST',
    headers: {
      'D360-API-KEY': D360_API_KEY,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const text = await resp.text();
  console.log(`➡️  360 status: ${resp.status} body: ${text}`);
  return { status: resp.status, body: text };
}

// --- Healthcheck / raiz ---
app.get('/', (_req, res) => {
  res.send('Kali Nutro IA estável');
});

// --- Webhook do 360dialog ---
app.post('/webhook', async (req, res) => {
  try {
    console.log('🟦 Webhook recebido');
    console.log('↩️ body:', JSON.stringify(req.body));
    // responde rápido pro WABA não reenviar
    res.status(200).send('OK');
  } catch { /* já respondido */ }

  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    const waNumberId = value?.metadata?.phone_number_id;
    const contact = value?.contacts?.[0];
    const profileName = contact?.profile?.name;
    const wa_id = contact?.wa_id;

    const messages = value?.messages;
    if (!Array.isArray(messages)) {
      console.log('ℹ️  Sem messages no payload.');
      return;
    }

    for (const msg of messages) {
      const from = msg?.from || wa_id; // redundância
      const type = msg?.type;
      console.log(`💬 de ${from}: tipo=${type}`);

      if (type === 'text' && msg?.text?.body) {
        const userText = msg.text.body;
        console.log(`📥 recebido: ${userText}`);

        // pede resposta “inteligente”
        let reply;
        try {
          reply = await aiReply(from, userText, profileName);
        } catch (e) {
          console.error('❌ Falha AI:', e);
          reply = 'Desculpe, tive um problema ao pensar na resposta. Pode repetir?';
        }

        await sendText(from, reply);
      } else {
        await sendText(from, 'Recebi sua mensagem 👍 (texto, imagem, áudio etc.)');
      }
    }
  } catch (err) {
    console.error('Erro ao processar webhook:', err);
  }
});

// --- Envio manual de teste ---
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
  console.log(`🚀 Kali Nutro IA estável rodando na porta ${PORT}`);
  console.log(`🔔 Endpoint 360: https://waba-v2.360dialog.io/messages`);
});

export { sendText };
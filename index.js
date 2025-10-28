// index.js — ES Module
import express from 'express';
import dotenv from 'dotenv';
import process from 'process';
import { aiReply } from './brain.js'; // <-- arquivo deve ser exatamente "brain.js" (minúsculo) na raiz

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;
const D360_API_KEY = process.env.D360_API_KEY;

// --- 360 v2: envio de texto ---
async function sendText(to, body) {
  const payload = {
    recipient_type: 'individual',
    to: String(to),
    type: 'text',
    text: { body: String(body) }
  };

  try {
    const resp = await fetch('https://waba-v2.360dialog.io/messages', {
      method: 'POST',
      headers: {
        'D360-API-KEY': D360_API_KEY || '',
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    const txt = await resp.text();
    console.log(`➡️  360 status: ${resp.status} body: ${txt}`);
    return { status: resp.status, body: txt };
  } catch (e) {
    console.error('❌ Erro ao chamar 360:', e);
    return { status: 0, body: String(e) };
  }
}

app.get('/', (_req, res) => res.send('Kali Nutro IA estável'));

app.post('/webhook', async (req, res) => {
  try {
    console.log('🟦 Webhook recebido');
    console.log('↩️ body:', JSON.stringify(req.body));
    // responde rápido para o 360 não reenviar
    res.status(200).send('OK');

    const msg = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    const from = msg?.from;
    const type = msg?.type;
    if (!from || !type) return;

    console.log(`💬 de ${from}: tipo=${type}`);

    // só tratamos texto aqui; demais tipos, manda resposta padrão
    if (type !== 'text') {
      await sendText(from, 'Recebi sua mensagem 👍');
      return;
    }

    const textIn = msg.text?.body || '';
    console.log(`📥 recebido: ${textIn}`);

    // =========== IA com fallback ===========
    let out = null;
    try {
      out = await aiReply(from, textIn, req.body?.entry?.[0]?.changes?.[0]?.value?.contacts?.[0]?.profile?.name || 'Paciente');
    } catch (e) {
      console.error('⚠️ Falha aiReply:', e);
    }

    if (!out || typeof out !== 'string') {
      out = `Recebi: ${textIn} ✅`; // fallback seguro
    }

    await sendText(from, out);
  } catch (err) {
    console.error('Erro no /webhook:', err);
    try { res.status(200).end(); } catch {}
  }
});

app.post('/send', async (req, res) => {
  const { to, body } = req.body || {};
  if (!to || !body) return res.status(400).json({ error: 'to e body obrigatórios' });
  const resp = await sendText(to, body);
  res.json(resp);
});

app.listen(PORT, () => {
  console.log(`🚀 Kali Nutro IA estável rodando na porta ${PORT}`);
  console.log(`🔔 Endpoint 360: https://waba-v2.360dialog.io/messages`);
});
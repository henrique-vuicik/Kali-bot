// index.js — versão corrigida (ES Module)
import express from 'express';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import process from 'process';

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;
const D360_API_KEY = process.env.D360_API_KEY; // 🔑 chave do número (Numbers -> Show API Key)

if (!D360_API_KEY) {
  console.warn('⚠️ D360_API_KEY não configurado — configure no Railway / Variables');
}

/**
 * Envia texto via 360dialog (API v2)
 * payload obrigatório: messaging_product, to, type, text.body
 */
async function sendText(to, body) {
  const payload = {
    messaging_product: 'whatsapp',
    to: String(to),
    type: 'text',
    text: { body: String(body) }
  };

  try {
    const resp = await fetch('https://waba-v2.360dialog.io/v1/messages', {
      method: 'POST',
      headers: {
        'D360-API-KEY': D360_API_KEY,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const respText = await resp.text();
    console.log(`➡️  360 status: ${resp.status} body: ${respText}`);
    return { status: resp.status, body: respText };
  } catch (err) {
    console.error('❌ Erro ao chamar 360dialog:', err);
    throw err;
  }
}

/**
 * Endpoint de saúde
 */
app.get('/', (req, res) => {
  res.send('✅ Kali Nutro IA estável e ouvindo o webhook.');
});

/**
 * Webhook (recebe mensagens do WhatsApp via 360dialog)
 */
app.post('/webhook', async (req, res) => {
  try {
    console.log('🟦 Webhook recebido');
    console.log('↩️ body:', JSON.stringify(req.body));

    // resposta imediata ao 360
    res.status(200).send('OK');

    // extrair mensagem
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const messages = value?.messages;

    if (!messages || !Array.isArray(messages)) {
      console.log('⚪ Nenhuma mensagem processável encontrada.');
      return;
    }

    for (const msg of messages) {
      const from = msg.from;
      const type = msg.type;
      console.log(`💬 de ${from}: tipo=${type}`);

      if (type === 'text' && msg.text?.body) {
        const received = msg.text.body;
        console.log(`📥 recebido: ${received}`);

        // responde confirmando
        await sendText(from, `Recebi sua mensagem: "${received}" ✅`);
      } else {
        await sendText(from, 'Recebi seu conteúdo! 🙌');
      }
    }
  } catch (err) {
    console.error('🔥 Erro no webhook:', err);
    try { res.status(500).send('erro'); } catch (_) {}
  }
});

/**
 * Endpoint manual: POST /send { "to": "554299401345", "body": "teste" }
 */
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

/**
 * Inicia o servidor
 */
app.listen(PORT, () => {
  console.log(`🚀 Kali Nutro IA estável rodando na porta ${PORT}`);
  console.log(`🔔 Endpoint 360: https://waba-v2.360dialog.io/v1/messages`);
});
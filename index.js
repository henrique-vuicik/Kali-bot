// index.js (CommonJS)
const express = require('express');
const crypto = require('crypto');
const axios = require('axios');

const app = express();
app.use(express.json({ limit: '10mb' }));

// ===== ENV =====
const PORT = process.env.PORT || 8080;

// 360dialog
const D360_TOKEN = process.env.D360_TOKEN || '';
const D360_URL = process.env.D360_API_URL || 'https://waba-v2.360dialog.io/v1/messages';

// Cloud API
const CLOUD_TOKEN = process.env.WHATSAPP_CLOUD_TOKEN || '';
const CLOUD_PHONE_ID = process.env.WHATSAPP_CLOUD_PHONE_ID || '';
const CLOUD_BASE = process.env.WABA_CLOUD_URL || 'https://graph.facebook.com/v21.0';

// ===== HELPERS =====
async function send360Text(to, body) {
  const payload = {
    to,
    type: 'text',
    text: { body, preview_url: false },
  };
  try {
    const { data } = await axios.post(D360_URL, payload, {
      headers: {
        'D360-API-KEY': D360_TOKEN,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    });
    return { ok: true, data, via: '360' };
  } catch (err) {
    const msg = (err.response && err.response.data) ? err.response.data : String(err);
    return { ok: false, error: msg, via: '360' };
  }
}

async function sendCloudText(to, body) {
  if (!CLOUD_TOKEN || !CLOUD_PHONE_ID) {
    return { ok: false, error: 'Cloud API não configurada', via: 'cloud' };
  }
  const url = `${CLOUD_BASE}/${CLOUD_PHONE_ID}/messages`;
  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body, preview_url: false },
  };
  try {
    const { data } = await axios.post(url, payload, {
      headers: { Authorization: `Bearer ${CLOUD_TOKEN}` },
      timeout: 15000,
    });
    return { ok: true, data, via: 'cloud' };
  } catch (err) {
    const msg = (err.response && err.response.data) ? err.response.data : String(err);
    return { ok: false, error: msg, via: 'cloud' };
  }
}

async function replyText(to, body) {
  // tenta 360 primeiro
  const r360 = await send360Text(to, body);
  if (r360.ok) return r360;

  // fallback cloud
  const rCloud = await sendCloudText(to, body);
  if (rCloud.ok) return rCloud;

  // retorna ambos erros pra log
  throw new Error(`Falha 360: ${JSON.stringify(r360.error)} | Falha Cloud: ${JSON.stringify(rCloud.error)}`);
}

// ===== WEBHOOK VERIFY (Cloud API) =====
app.get('/webhook', (req, res) => {
  const verifyToken = process.env.WHATSAPP_CLOUD_VERIFY_TOKEN || 'verify_me';
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token && mode === 'subscribe' && token === verifyToken) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// ===== WEBHOOK RECEIVE (compartilhado p/ 360 e Cloud) =====
app.post('/webhook', async (req, res) => {
  console.log('🟦 Webhook recebido');
  try {
    // Normalizar entrada: 360 envia em um formato; Cloud em outro.
    // Abaixo: tentamos pegar msg simples de texto/imagem com o número do remetente.
    let from, textBody, imageId;

    // 360dialog
    if (req.body && req.body.messages && Array.isArray(req.body.messages) && req.body.messages[0]) {
      const m = req.body.messages[0];
      from = m.from; // já vem E.164
      if (m.type === 'text' && m.text) textBody = m.text.body;
      if (m.type === 'image' && m.image) imageId = m.image.id;
    }

    // Cloud API
    if (!from && req.body && req.body.entry) {
      const changes = req.body.entry?.[0]?.changes?.[0];
      const msg = changes?.value?.messages?.[0];
      const contacts = changes?.value?.contacts?.[0];
      if (msg && contacts) {
        from = msg.from;
        if (msg.type === 'text' && msg.text) textBody = msg.text.body;
        if (msg.type === 'image' && msg.image) imageId = msg.image.id; // para futura análise
      }
    }

    if (!from) {
      console.log('⚠️ Payload sem remetente conhecido.');
      return res.sendStatus(200);
    }

    // Roteamento simples:
    if (textBody) {
      await replyText(from, 'Recebi sua mensagem! ✅');
    } else if (imageId) {
      // Aqui só responde confirmação (a análise de calorias pode ser ligada depois)
      await replyText(from, 'Recebi sua foto! Em breve estimarei calorias por imagem. 🤖📸');
    } else {
      await replyText(from, 'Mensagem recebida! (tipo não suportado ainda)');
    }

    return res.sendStatus(200);
  } catch (e) {
    console.error('🔥 Erro no webhook:', e?.message || e);
    return res.sendStatus(200);
  }
});

// ===== HEALTHCHECK =====
app.get('/', (_req, res) => res.send('Kali Nutro IA OK'));

app.listen(PORT, () => {
  console.log(`🟩 🚀 Kali Nutro IA rodando na porta ${PORT}`);
  console.log(`🔔 Endpoint primário 360: ${D360_URL}`);
});
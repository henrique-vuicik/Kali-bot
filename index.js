// index.js - 360dialog v2 + fallback (CommonJS)

const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');

// ---------- ENV ----------
const PORT = process.env.PORT || 8080;
const D360_API_KEY = process.env.D360_API_KEY || process.env.D360_APIKEY || process.env.D360_API || '';
const TEST_TO = process.env.TEST_TO || '';
const WHATSAPP_FROM = process.env.WHATSAPP_FROM || ''; // ex.: 554291251751 (sem +)

// Endpoints 360dialog
const BASE_V2 = 'https://waba-v2.360dialog.io';
const URL_V2_MESSAGES = `${BASE_V2}/v1/messages`;
// Endpoint “legacy” (proxy Graph) — ainda útil para comparar erros
const URL_LEGACY_MESSAGES = `${BASE_V2}/messages`;

// ---------- APP ----------
const app = express();
app.use(bodyParser.json());

// ---------- HELPERS ----------
const headers = () => ({
  'D360-API-KEY': D360_API_KEY,
  'Content-Type': 'application/json',
  'Accept': 'application/json'
});

function buildTextPayload(to, text) {
  // payload Cloud API compatível (inclui messaging_product)
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: String(to),
    type: 'text',
    text: {
      preview_url: false,
      body: text
    }
  };
  if (WHATSAPP_FROM) payload.from = String(WHATSAPP_FROM);
  return payload;
}

async function trySendVariations(to, text, tag = 'envio') {
  const body = buildTextPayload(to, text);

  // 1) v2 padrão
  try {
    console.log(`🟦 Enviando via: v1/messages (v2 360) -> ${URL_V2_MESSAGES} ${JSON.stringify(body)}`);
    const r = await axios.post(URL_V2_MESSAGES, body, { headers: headers(), timeout: 15000 });
    console.log(`🟩 OK ${r.status} em "v1/messages (v2 360)" ${JSON.stringify(r.data)}`);
    return { ok: true, data: r.data };
  } catch (e) {
    const status = e.response?.status ?? 'ERR';
    const data = e.response?.data ?? e.message;
    console.log(`🟥 Falha ${status} em "v1/messages (v2 360)" ${JSON.stringify(data)}`);
  }

  // 2) legacy (proxy Graph) — inclui também messaging_product (é requisito do Graph)
  try {
    console.log(`🟦 Enviando via: /messages (legacy) -> ${URL_LEGACY_MESSAGES} ${JSON.stringify(body)}`);
    const r2 = await axios.post(URL_LEGACY_MESSAGES, body, { headers: headers(), timeout: 15000 });
    console.log(`🟩 OK ${r2.status} em "messages (legacy)" ${JSON.stringify(r2.data)}`);
    return { ok: true, data: r2.data };
  } catch (e2) {
    const status = e2.response?.status ?? 'ERR';
    const data = e2.response?.data ?? e2.message;
    console.log(`🟥 Falha ${status} em "messages (legacy)" ${JSON.stringify(data)}`);
  }

  return { ok: false, error: 'Todas as variações falharam. Veja os logs acima.' };
}

// ---------- WEBHOOK ----------
app.post('/webhook', async (req, res) => {
  console.log('🟦 Webhook recebido');

  try {
    // Tenta normalizar formatos 360/Graph
    const body = req.body || {};
    let from, text;

    // 360 v2 (webhook padrão 360)
    if (body.from && body.text) {
      from = body.from;
      text = body.text;
    }

    // Meta Cloud (formato de entry/changes)
    if (!from || !text) {
      const changes = body.entry?.[0]?.changes?.[0]?.value;
      const msg = changes?.messages?.[0];
      if (msg?.from && msg?.text?.body) {
        from = msg.from;
        text = msg.text.body;
      }
    }

    if (!from || !text) {
      console.log(`🟨 Webhook sem texto ou remetente identificável: ${JSON.stringify(req.body)}`);
      return res.sendStatus(200);
    }

    console.log(`🟩 Mensagem recebida de ${from}: ${text}`);

    const reply = `Recebido: ${text}`;
    const sent = await trySendVariations(from, reply, 'resposta');

    if (!sent.ok) {
      console.log(`🟥 Erro ao enviar resposta ${JSON.stringify(sent)}`);
    }
    return res.sendStatus(200);
  } catch (err) {
    console.log('🟥 Erro no webhook', err?.message || err);
    return res.sendStatus(200);
  }
});

// ---------- HEALTH ----------
app.get('/', (_req, res) => res.send('OK'));

// ---------- START ----------
app.listen(PORT, async () => {
  console.log(`🟩 🚀 Servidor rodando na porta ${PORT}`);
  console.log(`🟦 🔔 Endpoint 360dialog: ${URL_V2_MESSAGES}`);

  if (!D360_API_KEY) {
    console.log('🟨 Falta D360_API_KEY nos variables do Railway!');
    return;
  }

  if (TEST_TO) {
    try {
      console.log('🟦 🔎 Rodando teste de envio inicial…');
      const r = await trySendVariations(TEST_TO, 'Teste automático ✅', 'teste');
      if (!r.ok) {
        console.log(`🟥 Teste automático FALHOU ${JSON.stringify(r)}`);
      }
    } catch (e) {
      console.log('🟥 Erro no teste automático', e?.response?.data || e.message);
    }
  } else {
    console.log('🟦 Teste automático não executado (defina TEST_TO e D360_API_KEY).');
  }
});
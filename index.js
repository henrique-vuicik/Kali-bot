// index.js (CommonJS)
// Requisitos: express, axios, body-parser
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');

// ---------- Config ----------
const PORT = process.env.PORT || 8080;
const D360_API_KEY = process.env.D360_API_KEY || '';
const D360_BASE_URL = (process.env.D360_BASE_URL || 'https://waba-v2.360dialog.io').replace(/\/+$/, '');
const WHATSAPP_FROM = process.env.WHATSAPP_FROM || ''; // opcional: só use se a 360 exigir
const TEST_TO = process.env.TEST_TO || '';             // número pra teste automático

// ---------- Util ----------
function logOk(msg, extra)   { console.log('🟩', msg, extra ? JSON.stringify(extra) : ''); }
function logInfo(msg, extra) { console.log('🟦', msg, extra ? JSON.stringify(extra) : ''); }
function logWarn(msg, extra) { console.log('🟨', msg, extra ? JSON.stringify(extra) : ''); }
function logErr(msg, extra)  { console.log('🟥', msg, extra ? JSON.stringify(extra) : ''); }

function httpClient() {
  return axios.create({
    baseURL: D360_BASE_URL,
    headers: {
      'D360-API-KEY': D360_API_KEY,
      'Content-Type': 'application/json'
    },
    timeout: 15000,
    validateStatus: () => true
  });
}

// ---------- Envio 360dialog ----------
/**
 * Tenta enviar texto com 3 variações, nessa ordem:
 * 1) POST /v1/messages  (payload "simples" da 360)
 * 2) POST /v1/messages  (payload com "messaging_product"/"recipient_type")
 * 3) POST /messages      (endpoint legado)
 * 
 * Se "WHATSAPP_FROM" estiver setado, ele acrescenta "from" (variações 1 e 2)
 */
async function sendText360({ to, body }) {
  const api = httpClient();
  const tries = [];

  // #1 – Padrão 360 (sem messaging_product)
  tries.push({
    name: 'v1/messages (padrão 360)',
    url: '/v1/messages',
    payload: {
      to: String(to),
      type: 'text',
      text: { body: String(body) },
      ...(WHATSAPP_FROM ? { from: String(WHATSAPP_FROM) } : {})
    }
  });

  // #2 – Mesmo endpoint, mas com "messaging_product"
  tries.push({
    name: 'v1/messages (+ messaging_product)',
    url: '/v1/messages',
    payload: {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: String(to),
      type: 'text',
      text: {
        preview_url: false,
        body: String(body)
      },
      ...(WHATSAPP_FROM ? { from: String(WHATSAPP_FROM) } : {})
    }
  });

  // #3 – Endpoint legado da 360
  tries.push({
    name: 'messages (legacy)',
    url: '/messages',
    payload: {
      to: String(to),
      type: 'text',
      text: { body: String(body) }
    }
  });

  for (const t of tries) {
    logInfo(`Enviando via: ${t.name} -> ${D360_BASE_URL}${t.url}`, t.payload);
    const res = await api.post(t.url, t.payload).catch(e => ({ status: 0, data: { error: e.message } }));
    const status = res.status || 0;

    if (status >= 200 && status < 300) {
      logOk(`OK ${status} em "${t.name}"`, res.data);
      return { ok: true, tryUsed: t.name, status, data: res.data };
    }

    // Erro: registra e tenta a próxima variação
    logErr(`Falha ${status} em "${t.name}"`, res.data);
    // Se for erro claro de "messaging_product is required", já sabemos que a #2 deve ser usada
    if (status === 400 && res?.data && JSON.stringify(res.data).toLowerCase().includes('messaging_product is required')) {
      logWarn('API exigiu "messaging_product". Tentando variação com esse campo…');
    }
  }

  return { ok: false, error: 'Todas as variações falharam. Veja os logs acima.' };
}

// ---------- Servidor ----------
const app = express();
app.use(bodyParser.json());

// Health / Home
app.get('/', (req, res) => {
  res.json({
    ok: true,
    service: 'kali-bot',
    base: D360_BASE_URL,
    time: new Date().toISOString()
  });
});

// Webhook de entrada (360dialog -> seu bot)
app.post('/webhook', async (req, res) => {
  logInfo('Webhook recebido');
  const body = req.body || {};

  try {
    // Normalmente 360 manda algo como:
    // { messages: [{ from: "55...", text: { body: "Oi" } , ... }] , ... }
    const msg = body?.messages?.[0] || body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0] || null;
    const from = msg?.from || body?.from;
    const text = msg?.text?.body || body?.text || '';

    if (!from) {
      logWarn('Webhook sem "from" identificável', body);
      res.status(200).json({ received: true });
      return;
    }

    logOk(`Mensagem recebida de ${from}: ${text || '(vazio)'}`);

    // Responde ecoando o texto
    const reply = text ? `Recebido: ${text}` : 'Recebido 👌';
    const sent = await sendText360({ to: from, body: reply });

    if (!sent.ok) {
      logErr('Erro ao enviar resposta', sent);
    }

    res.status(200).json({ received: true });
  } catch (e) {
    logErr('Exceção no webhook', { message: e.message, stack: e.stack });
    res.status(200).json({ received: true });
  }
});

// Inicia servidor
app.listen(PORT, async () => {
  logOk(`🚀 Servidor rodando na porta ${PORT}`);
  logInfo(`🔔 Endpoint 360dialog: ${D360_BASE_URL}/v1/messages`);

  // Teste automático na inicialização
  if (!D360_API_KEY) {
    logWarn('Falta D360_API_KEY nos variables do Railway!');
  }
  if (TEST_TO && D360_API_KEY) {
    logInfo('🔎 Rodando teste de envio inicial…');
    const sent = await sendText360({ to: TEST_TO, body: 'Teste automático ✅' });
    if (!sent.ok) {
      logErr('Teste automático FALHOU', sent);
    }
  } else {
    logInfo('Teste automático não executado (defina TEST_TO e D360_API_KEY).');
  }
});
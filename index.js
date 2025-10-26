// index.js — Kali Nutro IA (360dialog) — imagem com logs detalhados
// Node 18 (fetch nativo). CommonJS.

const express = require('express');
const app = express();
app.use(express.json({ limit: '5mb' }));

// ===== ENV =====
const PORT = process.env.PORT || 8080;
const BASE_URL = process.env.WABA_BASE_URL || 'https://waba-v2.360dialog.io';
const D360_API_KEY = process.env.D360_API_KEY;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'kali-verify';

console.log('\x1b[34m%s\x1b[0m', `🔔 Endpoint primário: ${BASE_URL}/v1/messages`);
console.log('\x1b[32m%s\x1b[0m', `🟩 🚀 Kali Nutro IA rodando na porta ${PORT}`);
if (!D360_API_KEY) console.warn('\x1b[33m%s\x1b[0m', '⚠️  D360_API_KEY não configurada.');

// ===== Helpers =====
function safeJson(txt) { try { return JSON.parse(txt); } catch { return { raw: txt }; } }

async function sendViaLegacy(to, body) {
  const url = `${BASE_URL}/messages`;
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: String(to),
    type: 'text',
    text: { body: String(body).slice(0, 4000), preview_url: false }
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'D360-API-KEY': D360_API_KEY, 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify(payload)
  });
  const text = await res.text().catch(() => '');
  if (!res.ok) {
    console.error('Falha legacy /messages', res.status, 'Payload:', JSON.stringify(payload), 'Resposta:', text);
    throw new Error(`legacy_${res.status}:${text || 'sem corpo'}`);
  }
  return safeJson(text);
}

async function sendViaV1(to, body) {
  const url = `${BASE_URL}/v1/messages`;
  const payload = {
    to: String(to),
    type: 'text',
    text: { body: String(body).slice(0, 4000), preview_url: false }
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'D360-API-KEY': D360_API_KEY, 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify(payload)
  });
  const text = await res.text().catch(() => '');
  if (!res.ok) {
    console.error('Falha v1/messages', res.status, 'Payload:', JSON.stringify(payload), 'Resposta:', text);
    throw new Error(`v1_${res.status}:${text || 'sem corpo'}`);
  }
  return safeJson(text);
}

// Envio com fallback
async function sendText360(to, body) {
  try { return await sendViaLegacy(to, body); }
  catch (e1) {
    console.warn('⚠️  Falha legacy, tentando v1/messages…', e1.message || e1);
    try { return await sendViaV1(to, body); }
    catch (e2) {
      console.error('\x1b[31m%s\x1b[0m', 'Falha ao enviar WhatsApp:', (e2.message || e2));
      throw e2;
    }
  }
}

// Download mídia via 360
async function downloadMedia360ById(mediaId) {
  const url = `${BASE_URL}/v1/media/${encodeURIComponent(mediaId)}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { 'D360-API-KEY': D360_API_KEY, 'Accept': '*/*' }
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    console.error('\x1b[31m%s\x1b[0m', 'Falha 360 ao baixar mídia:', err || res.statusText);
    throw new Error('media_not_found');
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get('content-type') || '';
  return { buffer, contentType };
}

// Download direto se vier link (padrão Cloud API)
async function downloadMediaByUrlDirect(link) {
  const res = await fetch(link, { method: 'GET' });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    console.error('\x1b[31m%s\x1b[0m', 'Falha ao baixar URL direta:', err || res.statusText);
    throw new Error('media_link_failed');
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get('content-type') || '';
  return { buffer, contentType };
}

// Calorias (simples)
function estimateCaloriesFromText(text) {
  const db = [
    { rx: /banana/i, kcal: 90, label: 'Banana (1 un média)' },
    { rx: /p(ã|a)o (franc[eê]s|frances)/i, kcal: 140, label: 'Pão francês (1 un)' },
    { rx: /ovo/i, kcal: 70, label: 'Ovo (1 un cozido)' },
    { rx: /cafe/i, kcal: 2, label: 'Café preto (1 xícara)' },
    { rx: /arroz/i, kcal: 170, label: 'Arroz cozido (1 xícara)' },
    { rx: /frango/i, kcal: 200, label: 'Frango grelhado (150g)' },
    { rx: /salada/i, kcal: 80, label: 'Salada simples (1 prato)' },
  ];
  const items = [];
  let total = 0;
  for (const it of db) {
    if (it.rx.test(text)) { items.push({ label: it.label, kcal: it.kcal }); total += it.kcal; }
  }
  return { items, total };
}

// ===== Webhook Verify (GET) =====
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) return res.status(200).send(challenge);
  return res.sendStatus(403);
});

// ===== Webhook Receiver (POST) =====
app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  try {
    console.log('\x1b[34m%s\x1b[0m', '🟦 Webhook recebido');

    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value  = change?.value;

    if (value?.statuses) return; // ignore status callbacks

    const msg = value?.messages?.[0];
    if (!msg) return;

    const from = msg.from;
    const type = msg.type;

    if (type === 'text') {
      const text = msg.text?.body || '';
      const { items, total } = estimateCaloriesFromText(text);
      let reply;
      if (items.length === 0) {
        reply = 'Me conte o que você comeu (ex.: "2 fatias de pão, 1 ovo e café") que eu estimo as calorias. 📋';
      } else {
        const linhas = items.map(i => `• ${i.label}: ${i.kcal} kcal`).join('\n');
        reply = `Itens:\n${linhas}\nTotal: ${total} kcal\nDica: Posso somar o dia todo — envie as demais refeições.`;
      }
      await sendText360(from, reply);
      return;
    }

    if (type === 'image') {
      // LOG COMPLETO do nó de imagem pra inspecionar os campos disponíveis
      console.log('🖼️  msg.image bruto:', JSON.stringify(msg.image || {}, null, 2));

      // 1) Campo típico na 360
      const mediaId360 = msg.image?.id;

      // 2) Campo típico do Cloud (por vezes 360 repassa como link)
      const mediaLink = msg.image?.link;

      if (!mediaId360 && !mediaLink) {
        console.warn('⚠️  Nenhum mediaId/link encontrado em msg.image');
        await sendText360(from, 'Não consegui ler a imagem. Pode reenviar uma foto nova? 🙏');
        return;
      }

      try {
        let media;
        if (mediaId360) {
          media = await downloadMedia360ById(mediaId360);
        } else if (mediaLink) {
          media = await downloadMediaByUrlDirect(mediaLink);
        }

        // Aqui entraria a IA de visão (OpenAI Vision) usando media.buffer
        await sendText360(from, 'Recebi sua foto! Em breve vou estimar calorias por imagem. 🧠📸');
      } catch (e) {
        console.error('\x1b[31m%s\x1b[0m', 'Falha fluxo imagem:', e?.message || e);
        await sendText360(from, 'Tive um problema ao baixar/analisar a foto. Pode enviar outra tirada agora? 🙏');
      }
      return;
    }

    await sendText360(from, 'Envie um texto com a refeição ou uma foto do prato. 🍽️');

  } catch (err) {
    console.error('\x1b[31m%s\x1b[0m', 'Erro no webhook:', err?.message || err);
  }
});

// Health
app.get('/', (_, res) => res.send('Kali Nutro IA (360dialog) OK'));
app.listen(PORT);
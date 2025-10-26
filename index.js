// Kali Nutro IA — 360dialog + Cloud fallback + GPT-4o Vision
// Node 18+

const express = require('express');
const app = express();
app.use(express.json({ limit: '10mb' }));

// ===== ENV =====
const PORT = process.env.PORT || 8080;
const BASE_URL = process.env.WABA_BASE_URL || 'https://waba-v2.360dialog.io';
const D360_API_KEY = process.env.D360_API_KEY;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'kali-verify';
const WHATSAPP_CLOUD_TOKEN = process.env.WHATSAPP_CLOUD_TOKEN || '';
const GRAPH_API_VERSION = process.env.GRAPH_API_VERSION || 'v21.0';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const VISION_MODEL = process.env.VISION_MODEL || 'gpt-4o';

console.log('\x1b[34m%s\x1b[0m', `🔔 Endpoint primário: ${BASE_URL}/v1/messages`);
console.log('\x1b[32m%s\x1b[0m', `🟩 🚀 Kali Nutro IA rodando na porta ${PORT}`);

// ===== Helpers =====
const isDigitsOnly = (s) => typeof s === 'string' && /^[0-9]+$/.test(s);
function safeJson(txt) { try { return JSON.parse(txt); } catch { return { raw: txt }; } }

// ===== Envio via 360dialog =====
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
    headers: { 'D360-API-KEY': D360_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const txt = await res.text();
  if (!res.ok) throw new Error(`legacy_${res.status}:${txt}`);
  return safeJson(txt);
}

async function sendViaV1(to, body) {
  const url = `${BASE_URL}/v1/messages`;
  const payload = { to, type: 'text', text: { body, preview_url: false } };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'D360-API-KEY': D360_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const txt = await res.text();
  if (!res.ok) throw new Error(`v1_${res.status}:${txt}`);
  return safeJson(txt);
}

async function sendText360(to, body) {
  try { return await sendViaLegacy(to, body); }
  catch { return await sendViaV1(to, body); }
}

// ===== Download mídia =====
async function downloadMedia360ById(mediaId) {
  const url = `${BASE_URL}/v1/media/${encodeURIComponent(mediaId)}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { 'D360-API-KEY': D360_API_KEY, 'Accept': '*/*' }
  });
  if (!res.ok) throw new Error('media_not_found');
  const buffer = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get('content-type') || '';
  console.log('📥 Baixado via 360:', mediaId);
  return { buffer, contentType, via: '360' };
}

async function downloadMediaCloudById(mediaId) {
  const metaUrl = `https://graph.facebook.com/${GRAPH_API_VERSION}/${mediaId}`;
  const metaRes = await fetch(metaUrl, {
    headers: { 'Authorization': `Bearer ${WHATSAPP_CLOUD_TOKEN}` }
  });
  const meta = await metaRes.json();
  if (!meta.url) throw new Error('graph_url_missing');
  const fileRes = await fetch(meta.url, {
    headers: { 'Authorization': `Bearer ${WHATSAPP_CLOUD_TOKEN}` }
  });
  if (!fileRes.ok) throw new Error('graph_download_failed');
  const buffer = Buffer.from(await fileRes.arrayBuffer());
  const contentType = fileRes.headers.get('content-type') || '';
  console.log('📥 Baixado via Cloud/Graph:', mediaId);
  return { buffer, contentType, via: 'cloud' };
}

async function downloadImageSmart(msgImage) {
  const mediaId = msgImage?.id;
  const link = msgImage?.link;
  if (link) {
    const r = await fetch(link);
    if (!r.ok) throw new Error('media_link_failed');
    const buffer = Buffer.from(await r.arrayBuffer());
    return { buffer, contentType: r.headers.get('content-type') || '', via: 'link' };
  }
  if (!mediaId) throw new Error('media_id_missing');
  if (isDigitsOnly(mediaId)) return await downloadMediaCloudById(mediaId);
  try { return await downloadMedia360ById(mediaId); }
  catch { return await downloadMediaCloudById(mediaId); }
}

// ===== IA de visão (GPT-4o) =====
async function analyzeImageCalories(buffer) {
  const b64 = buffer.toString('base64');
  const prompt = `
Você é uma nutricionista. Identifique os alimentos visíveis, estime as porções e calcule as calorias aproximadas.
Responda em JSON:
{
  "items": [{"name":"string","portion":"string","kcal":number}],
  "total": number,
  "advice": "string"
}`;
  const body = {
    model: VISION_MODEL,
    messages: [{
      role: "user",
      content: [
        { type: "text", text: prompt },
        { type: "input_image", image_url: `data:image/jpeg;base64,${b64}` }
      ]
    }],
    temperature: 0.2
  };
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const txt = await res.text();
  if (!res.ok) throw new Error(`openai_error: ${txt}`);
  const data = JSON.parse(txt);
  const content = data.choices?.[0]?.message?.content || "{}";
  const jsonMatch = content.match(/\{[\s\S]*\}$/);
  const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(content);
  return parsed;
}

// ===== Estimativa por texto =====
function estimateCaloriesFromText(text) {
  const db = [
    { rx: /banana/i, kcal: 90, label: 'Banana (1 un média)' },
    { rx: /p(ã|a)o (franc[eê]s|frances)/i, kcal: 140, label: 'Pão francês (1 un)' },
    { rx: /ovo/i, kcal: 70, label: 'Ovo (1 un)' },
    { rx: /cafe/i, kcal: 2, label: 'Café preto (1 xícara)' },
    { rx: /arroz/i, kcal: 170, label: 'Arroz cozido (1 xícara)' },
    { rx: /frango/i, kcal: 200, label: 'Frango grelhado (150g)' },
    { rx: /salada/i, kcal: 80, label: 'Salada simples (1 prato)' },
  ];
  const items = db.filter(i => i.rx.test(text)).map(i => ({ name: i.label, kcal: i.kcal }));
  const total = items.reduce((s, i) => s + i.kcal, 0);
  return { items, total };
}

// ===== Webhook Verify =====
app.get('/webhook', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === VERIFY_TOKEN)
    return res.status(200).send(req.query['hub.challenge']);
  return res.sendStatus(403);
});

// ===== Webhook Principal =====
app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  try {
    const msg = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!msg) return;
    const from = msg.from;
    const type = msg.type;

    if (type === 'text') {
      const text = msg.text?.body || '';
      const { items, total } = estimateCaloriesFromText(text);
      if (items.length === 0) {
        await sendText360(from, 'Me conte o que você comeu (ex.: "2 fatias de pão, 1 ovo e café") que eu estimo as calorias. 📋');
      } else {
        const linhas = items.map(i => `• ${i.name}: ${i.kcal} kcal`).join('\n');
        await sendText360(from, `Itens:\n${linhas}\nTotal: ${total} kcal\nDica: envie as outras refeições do dia!`);
      }
      return;
    }

    if (type === 'image') {
      console.log('🖼️ msg.image bruto:', JSON.stringify(msg.image || {}, null, 2));
      const media = await downloadImageSmart(msg.image);
      try {
        const result = await analyzeImageCalories(media.buffer);
        const items = result.items || [];
        if (!items.length) {
          await sendText360(from, 'Analisei a foto, mas não consegui identificar com segurança. Pode me descrever o prato? 🙏');
          return;
        }
        const linhas = items.map(i => `• ${i.name}: ${i.portion || ''} ≈ ${i.kcal} kcal`).join('\n');
        const msgBody = `Itens:\n${linhas}\n\n⚖️ Total estimado: *${Math.round(result.total || 0)} kcal*\nDica: ${result.advice || 'Inclua proteínas magras e fibras!'}`
        await sendText360(from, msgBody);
      } catch (e) {
        console.error('Falha IA imagem:', e.message);
        await sendText360(from, 'Recebi sua foto! Ainda estou ativando a estimativa por imagem. 😊');
      }
      return;
    }

    await sendText360(from, 'Envie um texto com a refeição ou uma foto do prato. 🍽️');

  } catch (err) {
    console.error('Erro no webhook:', err.message);
  }
});

// ===== Healthcheck =====
app.get('/', (_, res) => res.send('✅ Kali Nutro IA (360 + GPT-4o Vision) OK'));
app.listen(PORT);
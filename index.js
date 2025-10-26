// index.js — Kali Nutro IA (CommonJS, Node 18+)
// Node 18 já tem global fetch.

const express = require("express");
const bodyParser = require("body-parser");

const app = express();
app.use(bodyParser.json({ limit: "10mb" }));

// ---------------------- CONFIG ----------------------
const PORT = process.env.PORT || 8080;

// 360dialog
const D360_API_KEY = process.env.D360_API_KEY;
const D360_BASE = "https://waba-v2.360dialog.io";

// Cloud API (fallback)
const CLOUD_TOKEN = process.env.WHATSAPP_CLOUD_TOKEN; // long-lived token
const CLOUD_PHONE_ID = process.env.WHATSAPP_CLOUD_PHONE_ID; // phone number id
const GRAPH_BASE = "https://graph.facebook.com/v21.0";

// OpenAI
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const VISION_MODEL = process.env.VISION_MODEL || "gpt-4o";
const VISION_MODEL_FALLBACK = process.env.VISION_MODEL_FALLBACK || "gpt-4o-mini";

// ---------------------- HELPERS ----------------------
function log(...args) {
  console.log(...args);
}
function j(x) {
  try { return JSON.stringify(x); } catch { return String(x); }
}
function isQuotaError(err) {
  const msg = (err?.error?.message || err?.message || "").toLowerCase();
  const code = err?.error?.code || err?.code;
  return code === "insufficient_quota" ||
         msg.includes("insufficient_quota") ||
         msg.includes("exceeded your current quota");
}

// ---------------------- WHATSAPP SENDERS ----------------------
// 360: envia texto
async function sendText360(to, body) {
  const url = `${D360_BASE}/v1/messages`;
  const payload = { to, type: "text", text: { body, preview_url: false } };
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "D360-API-KEY": D360_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    const err = await r.text();
    throw new Error(`360 messages 400: ${err}`);
  }
  return r.json();
}

// Cloud: envia texto
async function sendTextCloud(to, body) {
  if (!CLOUD_TOKEN || !CLOUD_PHONE_ID) throw new Error("Cloud API não configurada");
  const url = `${GRAPH_BASE}/${CLOUD_PHONE_ID}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body, preview_url: false },
  };
  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${CLOUD_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    const err = await r.text();
    throw new Error(`Cloud messages 400: ${err}`);
  }
  return r.json();
}

// Wrapper: tenta 360, cai para Cloud se precisar
async function sendWhatsAppText(to, body) {
  try {
    await sendText360(to, body);
  } catch (e) {
    log("⚠️ Falha ao enviar via 360, tentando Cloud…", e.message || e);
    await sendTextCloud(to, body);
  }
}

// ---------------------- WHATSAPP MEDIA DOWNLOAD ----------------------
async function downloadImageBuffer(mediaId) {
  // 1) 360
  try {
    const url = `${D360_BASE}/v1/media/${mediaId}`;
    const r = await fetch(url, { headers: { "D360-API-KEY": D360_API_KEY } });
    if (!r.ok) {
      const text = await r.text();
      throw new Error(text);
    }
    const arrayBuffer = await r.arrayBuffer();
    if (arrayBuffer.byteLength > 0) return Buffer.from(arrayBuffer);
    throw new Error("empty buffer 360");
  } catch (err) {
    const msg = (err?.message || "").toLowerCase();
    if (!msg.includes("not found") && !msg.includes("media_not_found"))
      log("⚠️ Erro 360 media (não NotFound):", err.message || err);
    else log("ℹ️ 360 media_not_found — tentando Cloud/Graph…");
  }

  // 2) Cloud/Graph
  if (!CLOUD_TOKEN) throw new Error("Sem CLOUD_TOKEN para fallback de mídia");
  const infoUrl = `${GRAPH_BASE}/${mediaId}`;
  const info = await fetch(infoUrl, {
    headers: { Authorization: `Bearer ${CLOUD_TOKEN}` },
  });
  if (!info.ok) {
    const t = await info.text();
    throw new Error(`Graph info fail: ${t}`);
  }
  const meta = await info.json(); // {url, mime_type, ...}
  if (!meta.url) throw new Error("Graph: meta.url ausente");

  const bin = await fetch(meta.url, {
    headers: { Authorization: `Bearer ${CLOUD_TOKEN}` },
  });
  if (!bin.ok) {
    const t = await bin.text();
    throw new Error(`Graph download fail: ${t}`);
  }
  const ab = await bin.arrayBuffer();
  return Buffer.from(ab);
}

// ---------------------- OPENAI (Visão) ----------------------
async function askVision(bufferOrUrl) {
  const inputImage = typeof bufferOrUrl === "string"
    ? { type: "input_image", image_url: bufferOrUrl }
    : { type: "input_image", image_data: Buffer.from(bufferOrUrl).toString("base64") };

  const prompt = `Você é nutricionista. Pela foto, identifique alimentos, estime porções (g ou ml) e calorias.
Responda exatamente neste formato:
• item — porção ≈ kcal
Total: X kcal
Observação: (algo útil e breve).`;

  async function callModel(model) {
    const url = "https://api.openai.com/v1/responses";
    const payload = {
      model,
      input: [{
        role: "user",
        content: [
          { type: "input_text", text: prompt },
          inputImage,
        ],
      }],
    };
    const r = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      const e = new Error(`openai_error`);
      e.error = err?.error || err;
      throw e;
    }
    const data = await r.json();
    const text =
      data.output_text ||
      (Array.isArray(data.content) ? data.content.map(c => c?.text).join("\n") : "") ||
      (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) ||
      JSON.stringify(data);
    return (text || "").trim();
  }

  for (const model of [VISION_MODEL, VISION_MODEL_FALLBACK]) {
    try {
      log("🧠 Usando modelo:", model);
      const txt = await callModel(model);
      return `${txt}\n\n🤖 Modelo: ${model}`;
    } catch (err) {
      log(`❌ Erro ${model}:`, j(err));
      if (!isQuotaError(err)) continue;
      log("⚠️ Quota/limite — tentando fallback…");
    }
  }
  throw new Error("Falha total nos modelos de visão");
}

// ---------------------- BUSINESS LOGIC ----------------------
async function handleTextMessage(from, name, body) {
  const lower = (body || "").toLowerCase().trim();
  if (!lower) {
    return sendWhatsAppText(
      from,
      "Oi! Me diga o que você comeu (ex.: “2 fatias de pão, 1 ovo e café”) ou envie uma *foto do prato* que eu estimo as calorias. 🍽️📸"
    );
  }
  // Aqui você pode plugar seu estimador por texto existente.
  return sendWhatsAppText(
    from,
    "Beleza! Se quiser, *mande uma foto* que eu estimo as calorias visualmente também. 😉"
  );
}

async function handleImageMessage(from, name, imageObj) {
  // Confirmação rápida
  await sendWhatsAppText(from, "Recebi sua foto! Vou estimar as calorias por imagem. 🧠📸");

  const mediaId = imageObj?.id;
  if (!mediaId) {
    return sendWhatsAppText(from, "Não consegui identificar a mídia recebida. Pode reenviar? 🙏");
  }

  let imageBuf;
  try {
    log("🖼️  msg.image bruto:", j(imageObj));
    imageBuf = await downloadImageBuffer(mediaId);
    log("📥 Imagem obtida. Bytes:", imageBuf.length);
  } catch (e) {
    log("🚫 Falha download mídia:", e.message || e);
    return sendWhatsAppText(from, "Tive um problema ao baixar a foto. Pode tentar novamente? 🙏");
  }

  try {
    const result = await askVision(imageBuf);
    await sendWhatsAppText(from, result);
  } catch (e) {
    log("🚫 Falha IA visão:", e.message || e);
    await sendWhatsAppText(
      from,
      "Recebi sua foto, mas tive um problema técnico ao estimar as calorias. Pode tentar de novo mais tarde? 🙏"
    );
  }
}

// ---------------------- WEBHOOK ----------------------
app.post("/webhook", async (req, res) => {
  log("🟦 Webhook recebido");
  try {
    const body = req.body;
    const entry = body?.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value || body;
    const messages = value?.messages || [];

    if (!messages.length) {
      res.sendStatus(200);
      return;
    }

    const msg = messages[0];
    const from = msg.from;
    const name = value?.contacts?.[0]?.profile?.name || "Amigo(a)";

    if (msg.type === "text") {
      await handleTextMessage(from, name, msg.text?.body);
    } else if (msg.type === "image") {
      await handleImageMessage(from, name, msg.image);
    } else {
      await sendWhatsAppText(
        from,
        "No momento, entendo *texto* e *foto*. Me envie uma foto do seu prato ou descreva o que comeu. 🙂"
      );
    }

    res.sendStatus(200);
  } catch (e) {
    log("🔥 Erro no webhook:", e.message || e);
    res.sendStatus(200);
  }
});

// Ping
app.get("/", (_, res) => res.send("Kali Nutro IA online 🚀"));

app.listen(PORT, () => {
  log(`🚀 Kali Nutro IA rodando na porta ${PORT}`);
  log(`🔔 Endpoint primário: ${D360_BASE}/v1/messages`);
});
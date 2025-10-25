// index.js — Kali Nutro IA (texto + imagem) com fallback de envio 360dialog
// Node 18+ (fetch global). CommonJS.

const express = require("express");
const app = express();

app.use(express.json({ limit: "25mb" }));

// ==== ENV ====
const PORT = process.env.PORT || 8080;
const D360_API_BASE = "https://waba-v2.360dialog.io";
const D360_KEY = process.env.D360_API_KEY;     // obrigatório
const OPENAI_KEY = process.env.OPENAI_API_KEY; // obrigatório
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";

// ==== LOG helpers ====
const log = {
  info: (...a) => console.log("\x1b[34m%s\x1b[0m", a.join(" ")),
  ok:   (...a) => console.log("\x1b[32m%s\x1b[0m", a.join(" ")),
  err:  (...a) => console.error("\x1b[31m%s\x1b[0m", a.join(" ")),
};

// ==== Envio WhatsApp (com 3 tentativas) ====
async function sendWhatsAppText(to, body) {
  const common = {
    to,
    type: "text",
    text: { preview_url: false, body }
  };

  // 1) Endpoint v2 oficial
  const payloadV2 = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    ...common
  };
  const urlV2 = `${D360_API_BASE}/v1/messages`;
  let r = await fetch(urlV2, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "D360-API-KEY": D360_KEY
    },
    body: JSON.stringify(payloadV2)
  });

  if (r.ok) return r.json();

  const textV2 = await r.text().catch(() => "");
  log.err(`Falha v1/messages ${r.status}. Payload: ${JSON.stringify(payloadV2)}. Resposta: ${textV2}`);

  // Se for 400 genérico, tenta legacy com messaging_product
  if (r.status === 400) {
    const urlLegacy = `${D360_API_BASE}/messages`;
    const payloadLegacy = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      ...common
    };
    r = await fetch(urlLegacy, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "D360-API-KEY": D360_KEY
      },
      body: JSON.stringify(payloadLegacy)
    });

    if (r.ok) return r.json();

    const textLegacy = await r.text().catch(() => "");
    log.err(`Falha legacy /messages ${r.status}. Payload: ${JSON.stringify(payloadLegacy)}. Resposta: ${textLegacy}`);

    // 3) Última cartada: legacy sem messaging_product (algumas rotas antigas aceitam)
    const payloadLegacyOld = { ...common };
    r = await fetch(urlLegacy, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "D360-API-KEY": D360_KEY
      },
      body: JSON.stringify(payloadLegacyOld)
    });
    if (r.ok) return r.json();

    const textLegacyOld = await r.text().catch(() => "");
    throw new Error(`Falha legacy (sem messaging_product) ${r.status}. Payload: ${JSON.stringify(payloadLegacyOld)}. Resposta: ${textLegacyOld}`);
  }

  // Se não era 400, propaga erro
  throw new Error(`Falha v1/messages ${r.status}. Payload: ${JSON.stringify(payloadV2)}. Resposta: ${textV2}`);
}

// ==== Baixar mídia do 360dialog (tenta 3 formas) =====
async function downloadMediaBase64(mediaId) {
  const toDataUrl = async (resp) => {
    const ct = resp.headers.get("content-type") || "image/jpeg";
    const buf = Buffer.from(await resp.arrayBuffer());
    return `data:${ct};base64,${buf.toString("base64")}`;
  };

  // A) /v1/media/{id} -> pode ser binário ou JSON com {url}
  let resp = await fetch(`${D360_API_BASE}/v1/media/${mediaId}`, {
    headers: { "D360-API-KEY": D360_KEY }
  });
  if (resp.ok) {
    const ct = (resp.headers.get("content-type") || "").toLowerCase();
    if (!ct.includes("application/json")) return toDataUrl(resp);
    try {
      const j = await resp.json();
      if (j.url) {
        const r2 = await fetch(j.url, { headers: { "D360-API-KEY": D360_KEY } });
        if (r2.ok) return toDataUrl(r2);
      }
    } catch {}
  }

  // B) /v1/media/{id}/content
  resp = await fetch(`${D360_API_BASE}/v1/media/${mediaId}/content`, {
    headers: { "D360-API-KEY": D360_KEY }
  });
  if (resp.ok) return toDataUrl(resp);

  // C) redirecionamento manual
  resp = await fetch(`${D360_API_BASE}/v1/media/${mediaId}`, {
    headers: { "D360-API-KEY": D360_KEY },
    redirect: "manual"
  });
  if (resp.status === 302 || resp.status === 301) {
    const loc = resp.headers.get("location");
    if (loc) {
      const r3 = await fetch(loc, { headers: { "D360-API-KEY": D360_KEY } });
      if (r3.ok) return toDataUrl(r3);
    }
  }

  const lastTxt = await resp.text().catch(() => "");
  throw new Error(`Falha ao baixar mídia ${mediaId}: ${resp.status} ${lastTxt}`);
}

// ==== OpenAI (texto) ====
async function openaiCaloriesFromText(userText) {
  const system = `
Você é uma assistente de nutrologia que estima calorias com base em
porções comuns no Brasil. Quando houver incerteza, indique "~".
Responda de forma breve e prática.

Formato:
Itens:
• <alimento>: <quantidade> ≈ <kcal>
Total: <kcal total>
Dica: <dica curta>
  `.trim();

  const prompt = `Calcule as calorias do que a pessoa comeu: "${userText}". Considere medidas caseiras.`;

  const r = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: [
        { role: "system", content: system },
        { role: "user",   content: prompt }
      ]
    })
  });
  if (!r.ok) {
    const t = await r.text().catch(()=> "");
    throw new Error(`OpenAI texto falhou ${r.status}: ${t}`);
  }
  const data = await r.json();
  const out = data.output_text
    || (data.output && data.output[0]?.content?.[0]?.text)
    || "";
  return out.trim();
}

// ==== OpenAI (imagem) ====
async function openaiCaloriesFromImage(dataUrl) {
  const system = `
Você é uma assistente de nutrologia. Dada a foto de um prato, identifique
os alimentos, estime porções e calorias. Se houver molho/creme, considere.
Responda em português e de forma concisa.

Formato:
Itens:
• <alimento>: <porção> ≈ <kcal>
Total: <kcal total>
Dica: <dica curta>
  `.trim();

  const r = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: [
        { role: "system", content: system },
        {
          role: "user",
          content: [
            { type: "input_text", text: "Analise a foto do prato e estime calorias." },
            { type: "input_image", image_url: { url: dataUrl } }
          ]
        }
      ]
    })
  });

  if (!r.ok) {
    const t = await r.text().catch(()=> "");
    throw new Error(`OpenAI visão falhou ${r.status}: ${t}`);
  }
  const data = await r.json();
  const out = data.output_text
    || (data.output && data.output[0]?.content?.[0]?.text)
    || "";
  return out.trim();
}

// ==== Webhook ====
app.get("/", (_, res) => res.send("Kali Nutro IA OK"));
app.post("/webhook", async (req, res) => {
  res.sendStatus(200);
  try {
    log.info("🟦 Webhook recebido");
    const change = req.body?.entry?.[0]?.changes?.[0]?.value;
    if (!change) return;

    const msg = change.messages?.[0];
    if (!msg) return;

    const from = msg.from;
    if (!from) return;

    // IMAGEM
    if (msg.type === "image") {
      const mediaId = msg.image?.id || msg.image?.media_id || msg.image?.mediaId;
      if (mediaId) {
        try {
          const dataUrl = await downloadMediaBase64(mediaId);
          const answer = await openaiCaloriesFromImage(dataUrl);
          await sendWhatsAppText(from, answer);
        } catch (e) {
          log.err("Falha fluxo imagem:", e.message);
          await safeReply(from, "Tive um problema ao baixar/analisar a foto. Pode tentar novamente? 🙏");
        }
        return;
      }
    }

    // TEXTO
    let userText = null;
    if (msg.type === "text") userText = msg.text?.body || null;

    if (!userText) {
      await safeReply(from, "Oi! Envie a refeição (ex: “2 fatias de pão, 1 ovo e café preto”) ou mande uma *foto do prato* que eu estimo as calorias. 📸🍽️");
      return;
    }

    try {
      const answer = await openaiCaloriesFromText(userText);
      await sendWhatsAppText(from, answer);
    } catch (e) {
      log.err("Falha IA texto:", e.message);
      await safeReply(from, "Tive um problema para calcular agora. Pode escrever de outro jeito? 😊");
    }
  } catch (e) {
    log.err("Erro no webhook:", e.message);
  }
});

async function safeReply(to, text) {
  try { await sendWhatsAppText(to, text); } catch (e) { log.err(e.message); }
}

app.listen(PORT, () => {
  log.info(`🔔 Endpoint primário: ${D360_API_BASE}/v1/messages`);
  log.ok(`🚀 Kali Nutro IA rodando na porta ${PORT}`);
});
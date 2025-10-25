// index.js — Kali Nutro IA (texto + imagem)
// Node 18+ (usa fetch global). CommonJS.

const express = require("express");
const crypto = require("crypto"); // só p/ gerar ids de debug
const app = express();

app.use(express.json({ limit: "25mb" }));

// ==== ENV ====
const PORT = process.env.PORT || 8080;
const D360_API = "https://waba-v2.360dialog.io";
const D360_KEY = process.env.D360_API_KEY;                 // obrigatório
const OPENAI_KEY = process.env.OPENAI_API_KEY;             // obrigatório
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";

// ==== LOG helpers ====
const log = {
  info: (...a) => console.log("\x1b[34m%s\x1b[0m", a.join(" ")),
  ok:   (...a) => console.log("\x1b[32m%s\x1b[0m", a.join(" ")),
  err:  (...a) => console.error("\x1b[31m%s\x1b[0m", a.join(" ")),
};

// ==== Envio WhatsApp (usa v1/messages) ====
async function sendWhatsAppText(to, body) {
  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: { preview_url: false, body }
  };
  const url = `${D360_API}/v1/messages`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "D360-API-KEY": D360_KEY
    },
    body: JSON.stringify(payload)
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`Falha v1/messages ${r.status}. Payload: ${JSON.stringify(payload)}. Resposta: ${txt}`);
  }
  return r.json();
}

// ==== Baixar mídia do 360dialog pelo media_id =====
async function downloadMediaBase64(mediaId) {
  // 1) baixa binário
  const mediaUrl = `${D360_API}/v1/media/${mediaId}`;
  const r = await fetch(mediaUrl, {
    headers: { "D360-API-KEY": D360_KEY }
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`Falha ao baixar mídia ${mediaId}: ${r.status} ${t}`);
  }
  const buf = Buffer.from(await r.arrayBuffer());
  // 2) tenta inferir mime pelo cabeçalho
  const ct = r.headers.get("content-type") || "image/jpeg";
  const b64 = buf.toString("base64");
  return `data:${ct};base64,${b64}`;
}

// ==== OpenAI: texto -> calorias ====
async function openaiCaloriesFromText(userText) {
  const system = `
Você é uma assistente de nutrologia que estima calorias com base em
porções do dia a dia no Brasil. Quando houver incerteza, indique "~".
Responda em tom breve e prático.
Saída sempre neste formato:

Itens:
• <alimento>: <quantidade> ≈ <kcal>
Total: <kcal total>
Dica: <uma dica curta>
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
  // compat: extrai texto
  const out = data.output_text || (data.output && data.output[0] && data.output[0].content && data.output[0].content[0] && data.output[0].content[0].text) || "";
  return out.trim();
}

// ==== OpenAI: imagem -> descrição + calorias ====
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
  const out = data.output_text || (data.output && data.output[0] && data.output[0].content && data.output[0].content[0] && data.output[0].content[0].text) || "";
  return out.trim();
}

// ==== Webhook raiz ====
app.get("/", (_, res) => res.send("Kali Nutro IA OK"));
app.post("/webhook", async (req, res) => {
  res.sendStatus(200); // responde rápido ao WhatsApp

  try {
    log.info("🟦 Webhook recebido");
    const change = req.body?.entry?.[0]?.changes?.[0]?.value;
    if (!change) return;

    const msg = change.messages?.[0];
    if (!msg) return;

    const from = msg.from; // número do cliente
    if (!from) return;

    // === IMAGEM ===
    if (msg.type === "image" && msg.image?.id) {
      const mediaId = msg.image.id;                // <<-- ID CORRETO DA MÍDIA
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

    // === TEXTO ===
    let userText = null;
    if (msg.type === "text") userText = msg.text?.body || null;
    // (opcionais) mapas para outros tipos de mensagem podem ser adicionados aqui

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

// Envio “silencioso” (não lançar erro p/ não quebrar o fluxo de webhook)
async function safeReply(to, text) {
  try {
    await sendWhatsAppText(to, text);
  } catch (e) {
    log.err(e.message);
  }
}

app.listen(PORT, () => {
  log.ok(`🚀 Kali Nutro IA rodando na porta ${PORT}`);
  log.info(`🔔 Endpoint primário: ${D360_API}/v1/messages`);
});
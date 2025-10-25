// index.js — Kali Nutro IA (texto + foto) — usa fetch nativo do Node 18 (sem node-fetch)

const express = require("express");
const app = express();

app.use(express.json({ limit: "5mb" }));

// === ENV ===
const {
  PORT = 8080,
  D360_API_KEY,                          // obrigatório (360dialog)
  WA_API_BASE = "https://waba-v2.360dialog.io",
  OPENAI_API_KEY,                        // obrigatório (OpenAI)
  OPENAI_MODEL = "gpt-4o-mini",          // texto
  OPENAI_VISION_MODEL = "gpt-4o-mini",   // visão
  META_WA_CLOUD_TOKEN,                   // opcional (fallback Graph)
} = process.env;

const SEND_URL_V1 = `${WA_API_BASE}/v1/messages`;
const MEDIA_URL_V1 = (id) => `${WA_API_BASE}/v1/media/${id}`;

const log = {
  info: (...a) => console.log("\x1b[34m%s\x1b[0m", "🟦", ...a),
  ok:   (...a) => console.log("\x1b[32m%s\x1b[0m", "🟩", ...a),
  err:  (...a) => console.error("\x1b[31m%s\x1b[0m", ...a),
};

// === HELPERS (WhatsApp) ===
async function sendWhatsAppText(to, body) {
  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: String(to),
    type: "text",
    text: { preview_url: false, body: String(body || "").slice(0, 4000) },
  };

  // 1) v1/messages (360dialog)
  try {
    const r = await fetch(SEND_URL_V1, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "D360-API-KEY": D360_API_KEY,
      },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      log.err(`Falha v1/messages ${r.status}. Payload: ${JSON.stringify(payload)}. Resposta: ${t}`);
      throw new Error(`bad_request_${r.status}`);
    }
    return true;
  } catch {
    // 2) Fallback /messages (legado)
    try {
      const legacy = `${WA_API_BASE}/messages`;
      const r2 = await fetch(legacy, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "D360-API-KEY": D360_API_KEY,
        },
        body: JSON.stringify(payload),
      });
      if (!r2.ok) {
        const t2 = await r2.text().catch(() => "");
        log.err(`Falha legacy /messages ${r2.status}. Payload: ${JSON.stringify(payload)}. Resposta: ${t2}`);
        return false;
      }
      return true;
    } catch (e2) {
      log.err("Falha ao enviar WhatsApp:", e2?.message || e2);
      return false;
    }
  }
}

async function fetchMediaBufferFrom360(mediaId) {
  // 1) pedir URL de download ao 360
  const meta = await fetch(MEDIA_URL_V1(mediaId), {
    headers: { "D360-API-KEY": D360_API_KEY },
  });
  if (meta.status === 404) throw new Error("media_not_found");
  if (!meta.ok) {
    const t = await meta.text().catch(() => "");
    throw new Error(`media_meta_error_${meta.status}:${t}`);
  }
  const { url } = await meta.json();
  if (!url) throw new Error("media_url_empty");

  // 2) baixar arquivo público
  const bin = await fetch(url);
  if (!bin.ok) throw new Error(`media_download_${bin.status}`);
  const buf = Buffer.from(await bin.arrayBuffer());
  return buf;
}

async function fetchMediaBufferFallbackGraph(mediaId) {
  if (!META_WA_CLOUD_TOKEN) throw new Error("no_graph_token");
  // 1) pegar URL no Graph
  const meta = await fetch(`https://graph.facebook.com/v20.0/${mediaId}`, {
    headers: { Authorization: `Bearer ${META_WA_CLOUD_TOKEN}` },
  });
  if (!meta.ok) {
    const t = await meta.text().catch(() => "");
    throw new Error(`graph_meta_${meta.status}:${t}`);
  }
  const { url } = await meta.json();
  if (!url) throw new Error("graph_url_empty");
  // 2) baixar
  const bin = await fetch(url);
  if (!bin.ok) throw new Error(`graph_download_${bin.status}`);
  return Buffer.from(await bin.arrayBuffer());
}

// === IA (OpenAI) ===
async function askOpenAIText(prompt) {
  const r = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: [
        {
          role: "system",
          content:
            "Você é a Kali, assistente de nutrologia focada em dieta. Seja objetiva, educada e prática. Calcule calorias aproximadas em PT-BR e ofereça 1 dica curta.",
        },
        {
          role: "user",
          content:
            "Formate exatamente assim:\nItens:\n• item: qtd/unidade ≈ kcal\nTotal: X kcal\nDica: ...",
        },
        { role: "user", content: prompt },
      ],
    }),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`openai_text_${r.status}:${t}`);
  }
  const j = await r.json();
  return j.output_text?.trim() ||
         j.output?.[0]?.content?.[0]?.text?.trim() ||
         "Não consegui calcular agora.";
}

async function askOpenAIVision(buffer) {
  const base64 = buffer.toString("base64");
  const r = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_VISION_MODEL,
      input: [
        {
          role: "system",
          content:
            "Você é a Kali, assistente de nutrologia. Ao ver a foto do prato, identifique os alimentos e estime calorias em PT-BR. Seja cautelosa e peça confirmação quando necessário.",
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text:
                "Analise a imagem e responda assim:\nItens:\n• alimento: quantidade estimada ≈ kcal\nTotal: X kcal\nDica: ...\nSe estiver incerto, use '~' e assuma porções médias.",
            },
            { type: "input_image", image_data: base64, mime_type: "image/jpeg" },
          ],
        },
      ],
    }),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`openai_vision_${r.status}:${t}`);
  }
  const j = await r.json();
  return j.output_text?.trim() ||
         j.output?.[0]?.content?.[0]?.text?.trim() ||
         "Não consegui analisar a imagem agora.";
}

// === WEBHOOK ===
app.post("/webhook", async (req, res) => {
  log.info("🟦 Webhook recebido");
  res.sendStatus(200); // responde rápido

  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    const msg = value?.messages?.[0];
    const from = msg?.from || value?.contacts?.[0]?.wa_id;

    // TEXTO
    if (msg?.type === "text" && msg?.text?.body && from) {
      const text = (msg.text.body || "").trim();
      let reply;
      try {
        reply = await askOpenAIText(text);
      } catch (e) {
        log.err("Falha IA texto:", e?.message || e);
        reply = "Tive um problema para calcular agora. Pode escrever de outro jeito? 😊";
      }
      await sendWhatsAppText(from, reply);
      return;
    }

    // IMAGEM
    if (msg?.type === "image" && from) {
      const mediaId = msg.image?.id || msg.image?.media_id;
      if (!mediaId) {
        await sendWhatsAppText(from, "Não recebi o identificador da imagem. Pode tentar novamente? 🙏");
        return;
      }
      try {
        let buf;
        try {
          buf = await fetchMediaBufferFrom360(String(mediaId));
        } catch (e1) {
          log.err("Falha 360 ao baixar mídia:", e1.message);
          if (META_WA_CLOUD_TOKEN) {
            buf = await fetchMediaBufferFallbackGraph(String(mediaId));
          } else {
            throw e1;
          }
        }
        const answer = await askOpenAIVision(buf);
        await sendWhatsAppText(from, answer);
      } catch (e) {
        log.err("Falha fluxo imagem:", e?.message || e);
        await sendWhatsAppText(from, "Tive um problema ao baixar/analisar a foto. Pode tentar novamente? 🙏");
      }
      return;
    }

    // OUTROS
    if (from) {
      await sendWhatsAppText(
        from,
        "Oi! Envie a refeição (ex: “2 fatias de pão, 1 ovo e café preto”) ou mande uma *foto do prato* que eu estimo as calorias. 📸🍽️"
      );
    }
  } catch (e) {
    log.err("Erro no webhook:", e?.message || e);
  }
});

// HEALTH
app.get("/", (_, res) => res.send("Kali Nutro IA ✅"));
app.get("/health", (_, res) => res.json({ ok: true }));

// START
app.listen(PORT, () => {
  log.info(`🔔 Endpoint primário: ${SEND_URL_V1}`);
  log.ok(`🚀 Kali Nutro IA rodando na porta ${PORT}`);
});
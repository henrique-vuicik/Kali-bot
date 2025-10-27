// index.js — Kali-bot (somente 360dialog, estável)
// CommonJS para evitar erro de ESM ("Cannot use import...")

const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");

const app = express();
app.use(bodyParser.json({ limit: "10mb" }));

// ===== ENV =====
const PORT = process.env.PORT || 8080;
const D360_API_KEY = process.env.D360_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY; // opcional p/ visão
const TEST_TO = process.env.TEST_TO;

const D360_URL_MESSAGES = "https://waba-v2.360dialog.io/v1/messages";
const D360_URL_MEDIA = "https://waba-v2.360dialog.io/v1/media";

// ===== Helpers 360 =====
async function sendText360(to, body) {
  if (!D360_API_KEY) throw new Error("D360_API_KEY ausente");
  const payload = {
    to,                 // MSISDN: 55DDDNNNNNNN
    type: "text",
    text: { body, preview_url: false }
  };
  const headers = {
    "Content-Type": "application/json",
    "D360-API-KEY": D360_API_KEY
  };
  return axios.post(D360_URL_MESSAGES, payload, { headers });
}

async function sendImage360(to, link, caption) {
  const payload = {
    to,
    type: "image",
    image: { link, caption: caption || "" }
  };
  const headers = {
    "Content-Type": "application/json",
    "D360-API-KEY": D360_API_KEY
  };
  return axios.post(D360_URL_MESSAGES, payload, { headers });
}

async function downloadMedia360(mediaId) {
  const headers = { "D360-API-KEY": D360_API_KEY };
  // 360 retorna o binário diretamente
  const res = await axios.get(`${D360_URL_MEDIA}/${mediaId}`, {
    headers,
    responseType: "arraybuffer",
    validateStatus: () => true
  });
  if (res.status !== 200) {
    throw new Error(`media_not_found (${res.status})`);
  }
  return Buffer.from(res.data);
}

// ===== OpenAI visão (opcional) =====
async function estimateCaloriesFromImage(bufferJpeg) {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY ausente");
  const b64 = bufferJpeg.toString("base64");
  const dataUrl = `data:image/jpeg;base64,${b64}`;

  // Uso do chat.completions com input de imagem (modelo leve p/ custo)
  const prompt = `
Você é um nutricionista. A partir da imagem, estime:
- O que parece ser o alimento.
- Quantidade aproximada (em ml ou g).
- Calorias aproximadas (kcal).
- 1 dica curta.

Responda em 3 linhas no formato:
Itens: ...
Total: ... kcal
Dica: ...
`.trim();

  const payload = {
    model: "gpt-4o-mini",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: dataUrl } }
        ]
      }
    ],
    temperature: 0.2
  };

  const r = await axios.post("https://api.openai.com/v1/chat/completions", payload, {
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    validateStatus: () => true
  });

  if (r.status !== 200) {
    const err = r.data?.error?.message || `openai_status_${r.status}`;
    throw new Error(err);
  }

  const text = r.data?.choices?.[0]?.message?.content?.trim();
  return text || "Não consegui estimar com segurança.";
}

// ===== Webhooks =====

// Saúde
app.get("/health", (_req, res) => {
  res.json({ ok: true, provider: "360dialog-only" });
});

// Webhook (coloque esta URL no 360: POST)
app.post("/webhook", async (req, res) => {
  try {
    // 360 encaminha o payload padrão do WhatsApp Cloud (entry/changes)
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const msg = value?.messages?.[0];
    if (!msg) return res.sendStatus(200);

    const from = msg.from || TEST_TO;
    if (!from) return res.sendStatus(200);

    // Texto
    if (msg.type === "text" && msg.text?.body) {
      const body = msg.text.body.trim();
      // Resposta simples de eco para validar fluxo
      await sendText360(from, `Recebi: "${body}" ✅`);
      return res.sendStatus(200);
    }

    // Imagem (estimativa)
    if (msg.type === "image" && msg.image?.id) {
      // Avise que recebeu e vai analisar (evita timeout de usuário)
      await sendText360(from, "Recebi sua foto! Vou estimar as calorias por imagem. 🤖📸");

      try {
        const bin = await downloadMedia360(msg.image.id);
        let resposta;
        try {
          resposta = await estimateCaloriesFromImage(bin);
        } catch (e) {
          // Falha na OpenAI (ex.: insufficient_quota)
          resposta = "Ainda estou ativando a estimativa por imagem (limite da IA atingido por enquanto). 😊";
        }
        await sendText360(from, resposta);
      } catch (e) {
        await sendText360(from, "Tive um problema ao baixar a imagem pelo 360. Pode tentar reenviar? 🙏");
      }
      return res.sendStatus(200);
    }

    // Outros tipos
    await sendText360(from, "Mensagem recebida! (tipo ainda não suportado) 🙌");
    res.sendStatus(200);
  } catch (err) {
    console.error("🔥 Erro no webhook:", err?.response?.data || err.message || err);
    // Nunca devolva !=200 para o provedor
    res.sendStatus(200);
  }
});

// Start
app.listen(PORT, () => {
  console.log(`🚀 Kali Nutro IA rodando na porta ${PORT}`);
  console.log(`🔔 Endpoint 360: ${D360_URL_MESSAGES}`);
});
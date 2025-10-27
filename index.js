// === KALI (versão estável – 360dialog somente) ===
const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");

const app = express();
app.use(bodyParser.json());

// ---------- ENV ----------
const PORT = process.env.PORT || 8080;
const D360_API_KEY = process.env.D360_API_KEY;          // API Key do 360 (Hub)
const TEST_TO = process.env.TEST_TO || "";              // Ex.: 554299401345 (E.164, sem +)

if (!D360_API_KEY) {
  console.error("❌ D360_API_KEY ausente. Defina a variável no Railway.");
  process.exit(1);
}

const D360_URL = "https://waba-v2.360dialog.io/v1/messages";

// ---------- SENDERS ----------
async function sendText360(to, body) {
  const payload = { to, type: "text", text: { body } }; // formato 360 (sem messaging_product)
  const resp = await axios.post(D360_URL, payload, {
    headers: {
      "D360-API-KEY": D360_API_KEY,
      "Content-Type": "application/json"
    },
    validateStatus: () => true
  });
  if (resp.status >= 200 && resp.status < 300) return resp.data;
  throw new Error(`360 ${resp.status}: ${JSON.stringify(resp.data)}`);
}

// ---------- HELPERS ----------
function extractMessage(entry) {
  // Webhook do 360 segue o padrão do WhatsApp Business:
  // body.entry[0].changes[0].value.messages[0]
  try {
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const messages = value?.messages || [];
    const contacts = value?.contacts || [];
    const msg = messages[0];
    const contact = contacts[0];

    const from = msg?.from || contact?.wa_id;  // remetente
    const type = msg?.type;                    // "text", "image", etc.
    const text = msg?.text?.body;
    const image = msg?.image;                  // { id, mime_type, sha256 }

    return { from, type, text, image, raw: msg };
  } catch {
    return null;
  }
}

// ---------- ROUTES ----------
app.get("/", (_req, res) => res.send("Kali (estável – 360) online ✅"));
app.get("/health", async (_req, res) => {
  try {
    if (TEST_TO) await sendText360(TEST_TO, "Ping de saúde ✅ (360)");
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/webhook", async (req, res) => {
  console.log("🟦 Webhook recebido");
  try {
    const entry = req.body?.entry?.[0];
    const msg = extractMessage(entry);

    if (!msg) {
      console.log("ℹ️  Sem mensagem válida no payload.");
      return res.sendStatus(200);
    }

    // Regras mínimas (estáveis):
    if (msg.type === "text" && msg.text) {
      // Resposta padrão estável p/ textos
      const reply =
        "Oi! 👋 Sou a Kali.\n" +
        "• Posso conversar sobre sua dieta, calcular macros, registrar refeições por texto.\n" +
        "• Envie uma *foto* do que comeu que eu acuso recebimento (análise por imagem virá depois).";
      await sendText360(msg.from, reply);
    } else if (msg.type === "image" && msg.image?.id) {
      // Apenas acusar recebimento (sem análise de imagem nesta versão)
      await sendText360(
        msg.from,
        "Recebi sua foto! ✅ Nesta versão estável não faço análise por imagem. "+
        "Se preferir, descreva o que comeu que eu estimo as calorias. 🍽️"
      );
    } else {
      await sendText360(msg.from, "Mensagem recebida! ✅ (formato ainda não suportado nesta versão estável).");
    }

    res.sendStatus(200);
  } catch (e) {
    console.error("🔥 Erro no webhook:", e.message);
    // Responder 200 para não gerar re-entrega infinita do WhatsApp
    res.sendStatus(200);
  }
});

// ---------- START ----------
app.listen(PORT, () => {
  console.log(`🚀 Kali (estável – 360) na porta ${PORT}`);
  console.log(`🔔 Endpoint 360: ${D360_URL}`);
});
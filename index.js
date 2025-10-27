const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json({ limit: "2mb" }));

const PORT = process.env.PORT || 8080;
const D360_API_KEY = process.env.D360_API_KEY;

// --- util de log seguro
function log(...args) {
  try { console.log(...args); } catch {}
}
function logErr(prefix, err) {
  const data = err?.response?.data;
  log(prefix, data ? JSON.stringify(data) : err?.message || err);
}

// --- envio via 360dialog
async function sendText(to, body) {
  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to, // E.164 SEM '+', ex: 5542999998888
    type: "text",
    text: { body, preview_url: false }
  };

  const url = "https://waba-v2.360dialog.io/v1/messages";
  const headers = {
    "Content-Type": "application/json",
    "D360-API-KEY": D360_API_KEY
  };

  const res = await axios.post(url, payload, { headers, timeout: 15000 });
  log("✅ Enviado", res.status, res.data?.messages?.[0]?.id || "");
  return res.data;
}

// health
app.get("/", (_, res) => res.send("🟢 Kali Nutro IA (360) on"));

// webhook principal
app.post("/webhook", async (req, res) => {
  log("🟦 Webhook recebido");
  // sempre responde 200 rapidamente
  res.sendStatus(200);

  try {
    // log insumo bruto (cuidado com volume)
    log("↩️ body:", JSON.stringify(req.body).slice(0, 2000));

    // 360 normalmente entrega em body.messages[0]
    const msg = req.body?.messages?.[0] || req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    const from = msg?.from || req.body?.from || req.body?.contacts?.[0]?.wa_id;
    const text =
      msg?.text?.body ??
      req.body?.text?.body ??
      req.body?.message?.text ??
      "";

    if (!from) {
      log("⚠️ Sem campo 'from' no payload");
      return;
    }

    const reply =
      text && text.trim()
        ? `Recebi: "${text.trim()}" 👌`
        : "Oi! Recebi sua mensagem 👍 (envie texto para começar).";

    await sendText(from, reply);
  } catch (err) {
    logErr("🔥 Erro no webhook:", err);
  }
});

app.listen(PORT, () => {
  log(`🚀 Kali Nutro IA estável rodando na porta ${PORT}`);
  log("🔔 Endpoint 360: https://waba-v2.360dialog.io/v1/messages");
});
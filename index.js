const express = require("express");
const axios = require("axios");
const bodyParser = require("body-parser");

// ➜ Variáveis vindas do Railway (NÃO usar dotenv)
const PORT = process.env.PORT || 8080;
const D360_API_KEY = process.env.D360_API_KEY;
const TEST_TO = process.env.TEST_TO || "554291251751";

// --- util para enviar texto via 360dialog ---
async function send360(to, body) {
  return axios.post(
    "https://waba-v2.360dialog.io/v1/messages",
    {
      recipient_type: "individual",
      to,
      type: "text",
      text: { body, preview_url: false }
    },
    {
      headers: {
        "Content-Type": "application/json",
        "D360-API-KEY": D360_API_KEY
      },
      timeout: 15000
    }
  );
}

const app = express();
app.use(bodyParser.json());

// Healthcheck
app.get("/", (_, res) => res.send("🟩 Kali (estável – 360) online"));

// Webhook
app.post("/webhook", async (req, res) => {
  console.log("🟦 Webhook recebido");
  try {
    const msg = req.body?.messages?.[0];
    if (!msg) return res.sendStatus(200);

    const from = msg.from;
    const texto = msg.text?.body?.trim() || "";

    if (texto) {
      await send360(from, "Recebi sua mensagem! 💬");
    } else {
      await send360(from, "Oi! Envie um texto para começar. ✨");
    }
    return res.sendStatus(200);
  } catch (e) {
    console.error("🔥 Erro no webhook:", e.response?.data || e.message);
    return res.sendStatus(200); // evita reentrega em loop
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Kali (estável – 360) na porta ${PORT}`);
  console.log("🔔 Endpoint 360: https://waba-v2.360dialog.io/v1/messages");
});
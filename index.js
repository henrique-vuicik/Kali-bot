const express = require("express");
const axios = require("axios");
const bodyParser = require("body-parser");

const app = express();
app.use(bodyParser.json());

// 🔧 Variáveis do ambiente Railway
const PORT = process.env.PORT || 8080;
const D360_API_KEY = process.env.D360_API_KEY;

// --- Função para enviar mensagem via 360dialog ---
async function sendMessage(to, body) {
  try {
    const payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: {
        body,
        preview_url: false
      }
    };

    const res = await axios.post(
      "https://waba-v2.360dialog.io/v1/messages",
      payload,
      {
        headers: {
          "Content-Type": "application/json",
          "D360-API-KEY": D360_API_KEY
        },
        timeout: 10000
      }
    );

    console.log("✅ Enviado com sucesso:", res.status);
  } catch (err) {
    console.error("❌ Falha ao enviar:", err.response?.data || err.message);
  }
}

// --- Healthcheck ---
app.get("/", (_, res) => {
  res.send("🟢 Kali Nutro IA (estável – 360dialog) rodando!");
});

// --- Webhook principal ---
app.post("/webhook", async (req, res) => {
  console.log("🟦 Webhook recebido");

  try {
    const msg = req.body?.messages?.[0];
    if (!msg) return res.sendStatus(200);

    const from = msg.from;
    const texto = msg.text?.body?.trim();

    if (texto) {
      console.log(`📩 Mensagem de ${from}: ${texto}`);
      await sendMessage(from, "Recebi sua mensagem! 👋");
    } else {
      await sendMessage(from, "Envie uma mensagem de texto para começar 💬");
    }

    res.sendStatus(200);
  } catch (error) {
    console.error("🔥 Erro no webhook:", error.message);
    res.sendStatus(200);
  }
});

// --- Inicialização ---
app.listen(PORT, () => {
  console.log(`🚀 Kali Nutro IA estável rodando na porta ${PORT}`);
  console.log("🔔 Endpoint 360:", "https://waba-v2.360dialog.io/v1/messages");
});
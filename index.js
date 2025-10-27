const express = require("express");
const axios = require("axios");
const bodyParser = require("body-parser");
require("dotenv").config();

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 8080;
const D360_API_KEY = process.env.D360_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const WHATSAPP_PHONE_NUMBER = process.env.WHATSAPP_PHONE_NUMBER;

// Função para enviar mensagens via 360dialog
async function enviarMensagem(to, texto) {
  try {
    await axios.post(
      "https://waba-v2.360dialog.io/v1/messages",
      {
        to,
        type: "text",
        text: { body: texto },
      },
      {
        headers: {
          "Content-Type": "application/json",
          "D360-API-KEY": D360_API_KEY,
        },
      }
    );
  } catch (err) {
    console.error("🔥 Erro ao enviar mensagem:", err.response?.data || err.message);
  }
}

// Webhook principal
app.post("/webhook", async (req, res) => {
  console.log("🟦 Webhook recebido");

  try {
    const message = req.body.messages?.[0];
    if (!message) return res.sendStatus(200);

    const from = message.from;
    const text = message.text?.body || "";

    if (text.toLowerCase().includes("oi")) {
      await enviarMensagem(from, "Olá! Aqui é a Kali 😊");
    } else {
      await enviarMensagem(from, "Mensagem recebida! 💬");
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("🔥 Erro no webhook:", err.response?.data || err.message);
    res.sendStatus(500);
  }
});

app.get("/", (req, res) => {
  res.send("🚀 Kali Nutro IA está online!");
});

app.listen(PORT, () => {
  console.log(`🟩 🚀 Kali Nutro IA rodando na porta ${PORT}`);
  console.log("🔔 Endpoint primário: https://waba-v2.360dialog.io/v1/messages");
});
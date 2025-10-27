import express from "express";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;
const API_URL = process.env.WHATSAPP_API_URL;
const D360_API_KEY = process.env.D360_API_KEY;

app.post("/webhook", async (req, res) => {
  console.log("🟦 Webhook recebido");
  const body = req.body;

  if (body.entry && body.entry[0].changes && body.entry[0].changes[0].value.messages) {
    const message = body.entry[0].changes[0].value.messages[0];
    const from = message.from;
    const text = message.text?.body || "";

    console.log("Mensagem recebida:", text);

    const reply = await getAIResponse(text);
    await sendMessage(from, reply);
  }

  res.sendStatus(200);
});

async function sendMessage(to, message) {
  const payload = {
    to: to,
    type: "text",
    text: { body: message }
  };

  try {
    const { data } = await axios.post(API_URL, payload, {
      headers: {
        "D360-API-KEY": D360_API_KEY,
        "Content-Type": "application/json"
      }
    });
    console.log("✅ Enviado:", data);
  } catch (err) {
    console.error("🔥 Erro ao enviar:", err.response?.data || err.message);
  }
}

async function getAIResponse(text) {
  try {
    const { data } = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-5",
        messages: [
          { role: "system", content: "Você é a Kali, assistente de nutrologia." },
          { role: "user", content: text }
        ]
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );
    return data.choices[0].message.content;
  } catch (err) {
    console.error("🔥 Erro OpenAI:", err.response?.data || err.message);
    return "Erro interno, tente novamente em instantes.";
  }
}

app.listen(PORT, () => {
  console.log(`🚀 Kali Nutro IA estável rodando na porta ${PORT}`);
  console.log(`🔔 Endpoint 360: ${API_URL}`);
});
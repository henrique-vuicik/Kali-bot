import express from "express";
import axios from "axios";
import morgan from "morgan";
import cors from "cors";

const app = express();
app.use(express.json());
app.use(cors());
app.use(morgan("dev"));

const PORT = process.env.PORT || 8080;
const D360_API_KEY = process.env.D360_API_KEY;
const D360_SEND_URL = "https://waba-v2.360dialog.io/v1/messages";

app.get("/health", (req, res) => res.send("ok"));

// Recebe mensagens do WhatsApp
app.post("/webhook", async (req, res) => {
  try {
    const data = req.body;

    console.log("📩 incoming:", JSON.stringify(data, null, 2));

    // Identifica o número e a mensagem recebida
    const from = data?.contacts?.[0]?.wa_id || data?.messages?.[0]?.from;
    const msg = data?.messages?.[0]?.text?.body || "";

    if (!from) {
      console.log("❌ Nenhum número encontrado");
      return res.sendStatus(200);
    }

    // Resposta padrão
    const reply = {
      messaging_product: "whatsapp",
      to: from,
      type: "text",
      text: {
        body: `Olá! Sou a assistente virtual Kali 🤖\n\nRecebi sua mensagem: "${msg}".\nComo posso ajudar você hoje?`,
      },
    };

    // Envia via 360dialog API
    const response = await axios.post(D360_SEND_URL, reply, {
      headers: { "D360-API-KEY": D360_API_KEY },
    });

    console.log("✅ sendText ok:", response.data);
    res.sendStatus(200);
  } catch (error) {
    console.error("❌ sendText error:", error.response?.data || error.message);
    res.sendStatus(200);
  }
});

app.listen(PORT, () => console.log(`🚀 Kali server listening on :${PORT}`));

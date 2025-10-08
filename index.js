import express from "express";
import axios from "axios";
import morgan from "morgan";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(morgan("tiny"));

const PORT = process.env.PORT || 3000;
const D360_API_KEY = process.env.D360_API_KEY;  // copie do painel da 360dialog
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "kali-verify";
const D360_SEND_URL = "https://waba.360dialog.io/v1/messages";

async function sendText(to, body) {
  try {
    await axios.post(
      D360_SEND_URL,
      { to, type: "text", text: { body } },
      { headers: { "D360-API-KEY": D360_API_KEY, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("sendText error:", err.response?.data || err.message);
  }
}

// healthcheck
app.get("/health", (_req, res) => res.send("ok"));

// verificação (opcional)
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode && token && token === VERIFY_TOKEN) return res.status(200).send(challenge || "verified");
  return res.sendStatus(403);
});

// webhook principal
app.post("/webhook", async (req, res) => {
  res.sendStatus(200); // responde rápido

  const payload = req.body;
  const messages = payload?.messages;
  const contacts = payload?.contacts;
  if (!messages || !messages.length) return;

  const msg = messages[0];
  const from = contacts?.[0]?.wa_id || msg?.from; // número do usuário

  if (!from) return;

  if (msg.type === "text") {
    const text = (msg.text?.body || "").trim();
    const reply =
      /^(oi|olá|ola|bom dia|boa tarde|boa noite)\b/i.test(text)
        ? "Bem-vindo(a)! Eu sou a Kali 👋 Posso ajudar com (1) agendamento, (2) check-in semanal ou (3) informações sobre o acompanhamento."
        : "Oi! Eu sou a Kali 👋 Como posso te ajudar?";
    await sendText(from, reply);
  } else if (msg.type === "image") {
    await sendText(from, "Recebi sua imagem 📷. Em breve analiso fotos!");
  } else {
    await sendText(from, "Mensagem recebida ✅");
  }
});

app.listen(PORT, () => console.log(`Kali server listening on :${PORT}`));

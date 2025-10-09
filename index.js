import express from "express";
import axios from "axios";
import morgan from "morgan";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(morgan("tiny"));

const PORT = process.env.PORT || 3000;
const D360_API_KEY = process.env.D360_API_KEY;              // VARIÁVEL NO RAILWAY
const D360_SEND_URL = "https://waba-v2.360dialog.io/v1/messages"; // v2 para Cloud API

// --- rotas de saúde ---
app.get("/", (_req, res) => res.send("ok"));
app.get("/health", (_req, res) => res.send("ok"));

// --- helper: enviar texto ---
async function sendText(to, body) {
  try {
    const { data } = await axios.post(
      D360_SEND_URL,
      {
        messaging_product: "whatsapp",
        to,                      // wa_id sem "+" (a 360 já manda assim)
        type: "text",
        text: { body, preview_url: false }
      },
      {
        headers: {
          "D360-API-KEY": D360_API_KEY,
          "Content-Type": "application/json"
        },
        timeout: 15000
      }
    );
    console.log("✅ sendText ok:", JSON.stringify(data));
  } catch (err) {
    const e = err?.response?.data || err.message;
    console.error("❌ sendText error:", e);
  }
}

// --- webhook principal (360 -> aqui) ---
app.post("/webhook", async (req, res) => {
  // responda 200 imediatamente para não dar timeout no provedor
  res.sendStatus(200);

  try {
    const payload = req.body;
    console.log("📩 incoming:", JSON.stringify(payload));

    // formato comum da 360/Cloud API:
    // { contacts: [{ wa_id }], messages: [{ from, type, text: { body } , ...}] }
    const msg = payload?.messages?.[0];
    if (!msg) return;

    // número do usuário (wa_id sem +)
    const from =
      payload?.contacts?.[0]?.wa_id ||
      msg?.from ||
      msg?.source?.wa_id ||
      null;

    if (!from) {
      console.warn("⚠️ sem 'from/wa_id' no payload");
      return;
    }

    // tipos básicos
    if (msg.type === "text") {
      const userText = (msg.text?.body || "").trim();

      // resposta simples/MVP
      let reply =
        "Oi! Eu sou a Kali 👋, assistente do Dr. Henrique. Posso ajudar com (1) agendamento, (2) check-in semanal ou (3) dúvidas rápidas.";
      if (/^(oi|olá|ola|bom dia|boa tarde|boa noite)\b/i.test(userText)) {
        reply =
          "Bem-vindo(a)! Quer começar por (1) agendar, (2) check-in semanal ou (3) saber como funciona o acompanhamento?";
      }

      await sendText(from, reply);
    } else if (msg.type === "image") {
      await sendText(from, "Recebi sua imagem 📷. Em breve consigo analisá-la!");
    } else {
      await sendText(from, "Mensagem recebida ✅");
    }
  } catch (e) {
    console.error("❌ webhook handler error:", e?.message || e);
  }
});

app.listen(PORT, () => console.log(`🚀 Kali server listening on :${PORT}`));

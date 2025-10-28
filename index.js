// index.js — ES Module
import express from "express";
import dotenv from "dotenv";
import process from "process";
import { thinkReply } from "./brain.js";

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;
const D360_API_KEY = process.env.D360_API_KEY; // Numbers -> Show API Key

if (!D360_API_KEY) {
  console.warn("⚠️ D360_API_KEY não configurado — configure no Railway / env vars");
}

/**
 * Envia texto via 360dialog v2
 * Payload CORRETO (sem messaging_product):
 * {
 *   recipient_type: 'individual',
 *   to: '55429xxxxxxx',
 *   type: 'text',
 *   text: { body: 'mensagem' }
 * }
 */
async function sendText(to, body) {
  const payload = {
    recipient_type: "individual",
    to: String(to),
    type: "text",
    text: { body: String(body) }
  };

  try {
    const resp = await fetch("https://waba-v2.360dialog.io/messages", {
      method: "POST",
      headers: {
        "D360-API-KEY": D360_API_KEY,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify(payload)
    });

    const respText = await resp.text();
    console.log(`➡️  360 status: ${resp.status} body: ${respText}`);
    return { status: resp.status, body: respText };
  } catch (err) {
    console.error("Erro ao chamar 360dialog:", err);
    throw err;
  }
}

// Health
app.get("/", (_req, res) => {
  res.send("Kali Nutro IA estável");
});

// Webhook (recebe eventos do WhatsApp/360dialog)
app.post("/webhook", async (req, res) => {
  try {
    console.log("🟦 Webhook recebido");
    console.log("↩️ body:", JSON.stringify(req.body));

    // responde rápido para o WABA não reenviar
    res.status(200).send("OK");

    const entry = req.body?.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const messages = value?.messages;

    if (!messages || !Array.isArray(messages)) {
      console.log("Nenhuma mensagem processável encontrada no webhook.");
      return;
    }

    for (const msg of messages) {
      const from = msg.from; // ex: 55429...
      const type = msg.type;
      console.log(`💬 de ${from}: tipo=${type}`);

      try {
        if (type === "text" && msg.text?.body) {
          const received = msg.text.body;
          console.log(`📥 recebido: ${received}`);

          // ===== inteligência =====
          const reply = await thinkReply(received);
          await sendText(from, reply);
        } else {
          await sendText(from, "Recebi sua mensagem. Obrigado!");
        }
      } catch (innerErr) {
        console.error("Erro ao processar mensagem individual:", innerErr);
        try {
          await sendText(from, "Tive um problema ao responder agora. Pode repetir?");
        } catch {}
      }
    }
  } catch (err) {
    console.error("Erro no endpoint /webhook:", err);
    try {
      res.status(500).send("erro");
    } catch {}
  }
});

// Endpoint opcional para testes manuais
app.post("/send", async (req, res) => {
  const { to, body } = req.body || {};
  if (!to || !body) return res.status(400).json({ error: "to e body obrigatórios" });

  try {
    const resp = await sendText(to, body);
    res.json(resp);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Kali Nutro IA estável rodando na porta ${PORT}`);
  console.log(`🔔 Endpoint 360: https://waba-v2.360dialog.io/messages`);
});
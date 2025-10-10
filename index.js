// index.js - integração mínima 360Dialog + Railway
import express from "express";

const app = express();
app.use(express.json());

// 🔧 Variáveis de ambiente
const PORT = process.env.PORT || 8080;
const D360_BASE = (process.env.D360_BASE || "https://waba-v2.360dialog.io").replace(/\/+$/, "");
const D360_API_KEY = process.env.D360_API_KEY;
const WABA_ID = process.env.WABA_ID;
const FROM_NUMBER = process.env.FROM_NUMBER;

// 🚀 Rota principal
app.get("/", (_req, res) => res.status(200).send("✅ Kali bot online!"));

// 📩 Webhook do 360
app.post("/webhook", async (req, res) => {
  try {
    const body = req.body || {};
    const change = body.entry?.[0]?.changes?.[0]?.value;
    const msg = change?.messages?.[0];
    const from = msg?.from;
    const text = msg?.text?.body;

    if (!from || !text) {
      console.log("ℹ️ Payload recebido sem mensagem de texto.");
      return res.sendStatus(200);
    }

    console.log(`💬 msg de ${from}: "${text}"`);

    if (!D360_API_KEY || !WABA_ID) {
      console.error("❌ Faltam variáveis D360_API_KEY ou WABA_ID");
      return res.sendStatus(500);
    }

    // 🔗 Monta URL completa
    const url = `${D360_BASE}/v1/messages`;

    // 📦 Payload correto conforme documentação 360Dialog
    const payload = {
      from: WABA_ID,        // <-- ID do seu canal (não o número com DDI)
      to: from,
      type: "text",
      text: { body: `Recebi: ${text}` }
    };

    // 📤 Envia a resposta para o WhatsApp via 360
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "D360-API-KEY": D360_API_KEY
      },
      body: JSON.stringify(payload)
    });

    const out = await response.text();

    if (!response.ok) {
      console.error(`🛑 360 erro: ${response.status} ${out}`);
    } else {
      console.log(`✅ Enviado 360: ${out.slice(0, 200)}`);
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("❌ Erro ao processar mensagem:", err);
    res.sendStatus(200);
  }
});

// 🧹 Encerramento limpo no Railway
process.on("SIGTERM", () => {
  console.log("🛑 SIGTERM — encerrando...");
  process.exit(0);
});

// ▶️ Inicializa servidor
app.listen(PORT, () => console.log(`🚀 listening :${PORT}`));

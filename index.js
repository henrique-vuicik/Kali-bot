// index.js - 360 minimal echo
import express from "express";

const app = express();
app.use(express.json());

// ENV
const PORT = process.env.PORT || 8080;
const D360_BASE = (process.env.D360_BASE || "https://waba-v2.360dialog.io").replace(/\/+$/,"");
const D360_API_KEY = process.env.D360_API_KEY;
const FROM_NUMBER = process.env.FROM_NUMBER;

// ping
app.get("/", (_req, res) => res.status(200).send("ok"));

// webhook 360
app.post("/webhook", async (req, res) => {
  try {
    const body = req.body || {};
    const change = body.entry?.[0]?.changes?.[0]?.value;
    const msg = change?.messages?.[0];
    const from = msg?.from;
    const text = msg?.text?.body;

    if (!from || !text) {
      console.log("ℹ️ payload sem texto ou sem from. Nada a fazer.");
      return res.sendStatus(200);
    }

    console.log(`📥 msg de ${from}: "${text}"`);

    if (!D360_API_KEY || !FROM_NUMBER) {
      console.error("❌ Faltam envs D360_API_KEY ou FROM_NUMBER");
      return res.sendStatus(500);
    }

    // URL COMPLETA (corrige ERR_INVALID_URL)
    const url = `${D360_BASE}/v1/messages`;

    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "D360-API-KEY": D360_API_KEY
      },
      body: JSON.stringify({
        from: FROM_NUMBER,
        to: from,
        type: "text",
        text: { body: `Recebi: ${text}` }
      })
    });

    const out = await r.text();
    if (!r.ok) {
      console.error("🛑 360 erro:", r.status, out);
    } else {
      console.log("✅ Enviado 360:", out.slice(0, 200));
    }

    res.sendStatus(200);
  } catch (e) {
    console.error("❌ Erro ao processar:", e);
    res.sendStatus(200);
  }
});

// graceful shutdown
process.on("SIGTERM", () => {
  console.log("🛑 SIGTERM recebido (Railway redeploy). Encerrando...");
  process.exit(0);
});

app.listen(PORT, () => console.log(`🚀 listening :${PORT}`));

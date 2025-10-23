// index.js
// Kali Cloud - integração WhatsApp via 360dialog

import express from "express";

const app = express();
app.use(express.json({ verify: (req, _res, buf) => (req.rawBody = buf?.toString?.() || "") }));

// =========================
// CONFIGURAÇÕES
// =========================
const PORT = process.env.PORT || 8080;
const D360_API_KEY = (process.env.D360_API_KEY || process.env.CLOUD_API_TOKEN || "").trim();
const API_URL = "https://waba-v2.360dialog.io/v1/messages";

// =========================
// LOG BONITO
// =========================
const log = (tag, msg, extra) => {
  const icon = tag === "ERR" ? "🟥" : tag === "OK" ? "🟩" : tag === "IN" ? "🟦" : "ℹ️";
  console.log(`${icon} ${msg}`, extra ? (typeof extra === "string" ? extra : JSON.stringify(extra)) : "");
};

// =========================
// HEALTHCHECK
// =========================
app.get("/", (_req, res) => {
  res.status(200).send({
    status: "ok",
    provider: "360dialog",
    api_url: API_URL,
  });
});

// =========================
// FUNÇÃO PARA ENVIAR MENSAGEM
// =========================
async function sendMessage(to, bodyText) {
  const payload = {
    preview_url: false,
    recipient_type: "individual",
    to,
    type: "text",
    text: { body: bodyText },
  };

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "D360-API-KEY": D360_API_KEY,
      },
      body: JSON.stringify(payload),
    });

    const data = await response.text();
    if (!response.ok) throw new Error(`${response.status} ${data}`);

    log("OK", "Mensagem enviada com sucesso", data);
    return data;
  } catch (error) {
    log("ERR", "Falha no envio", error.message);
  }
}

// =========================
// WEBHOOK DE RECEBIMENTO
// =========================
app.post("/webhook", async (req, res) => {
  log("IN", "Webhook recebido");

  try {
    const message = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    const from = message?.from || "";
    const text = message?.text?.body || "";

    if (!from || !text) {
      log("ERR", "Webhook sem 'from' ou 'text'", req.body);
      return res.sendStatus(200);
    }

    log("OK", `Mensagem recebida de ${from}: ${text}`);

    let reply = "👋 Oi! Eu sou a Kali, sua assistente de nutrição. Tudo bem?";
    const lower = text.trim().toLowerCase();

    if (["oi", "olá", "ola"].includes(lower)) {
      reply = "👋 Olá! Como posso te ajudar hoje?";
    } else if (lower.includes("cardápio") || lower.includes("cardapio")) {
      reply = "📋 Posso montar um cardápio básico pra você. Quais seus horários e restrições?";
    } else if (lower.includes("tirzepatida")) {
      reply = "💉 A tirzepatida pode ser um ótimo suporte, mas requer acompanhamento médico. Deseja saber mais?";
    }

    await sendMessage(from, reply);
    res.sendStatus(200);
  } catch (error) {
    log("ERR", "Erro no webhook", error.message);
    res.sendStatus(200);
  }
});

// =========================
// START SERVER
// =========================
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  console.log(`🔔 Endpoint 360dialog: ${API_URL}`);
  if (!D360_API_KEY) console.log("⚠️ ATENÇÃO: D360_API_KEY não configurada!");
});
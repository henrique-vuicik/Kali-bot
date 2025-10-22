// index.js
// Bot WhatsApp via 360dialog — responde com texto simples

import express from "express";

// ====== Variáveis de ambiente (Railway) ======
const PORT = process.env.PORT || 8080;
const CLOUD_API_URL = (process.env.CLOUD_API_URL || "https://waba-v2.360dialog.io").trim();
// D360-API-KEY da 360dialog (pode chamar CLOUD_API_TOKEN ou D360_API_KEY)
const CLOUD_API_TOKEN = (process.env.CLOUD_API_TOKEN || process.env.D360_API_KEY || "").trim();
const PHONE_NUMBER_ID = (process.env.PHONE_NUMBER_ID || "").trim(); // só para log

// ====== App ======
const app = express();
app.use(express.json({ verify: (req, _res, buf) => (req.rawBody = buf?.toString?.() || "") }));

const log = (tag, msg, extra) => {
  const icon = tag === "ERR" ? "🟥" : tag === "OK" ? "🟩" : tag === "IN" ? "🟦" : "ℹ️";
  console.log(icon, msg, extra ? (typeof extra === "string" ? extra : JSON.stringify(extra)) : "");
};

// Healthcheck
app.get("/", (_req, res) => {
  res.status(200).send({
    status: "ok",
    provider: "360dialog",
    url: CLOUD_API_URL,
    phone_number_id: PHONE_NUMBER_ID || undefined,
  });
});

// Envio de mensagem (360dialog: POST /messages)
async function sendMessage(to, textBody) {
  const url = `${CLOUD_API_URL}/messages`;
  const headers = {
    "Content-Type": "application/json",
    "D360-API-KEY": CLOUD_API_TOKEN,
  };
  const payload = {
    to,
    type: "text",
    text: { body: textBody },
  };

  const rsp = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    // 20s de timeout manual
    signal: AbortSignal.timeout ? AbortSignal.timeout(20000) : undefined,
  });

  const bodyText = await rsp.text().catch(() => "");
  let body;
  try { body = bodyText ? JSON.parse(bodyText) : {}; } catch { body = bodyText; }

  if (!rsp.ok) {
    log("ERR", `Falha no envio (${rsp.status})`, body);
    throw new Error(`sendMessage ${rsp.status}: ${bodyText}`);
  }

  log("OK", "Mensagem enviada com sucesso", body);
  return body;
}

// Webhook de entrada
app.post("/webhook", async (req, res) => {
  log("IN", "Webhook recebido");

  try {
    const message = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0] || null;
    const from = message?.from?.toString?.() || "";
    const text = message?.text?.body || "";

    if (!from || !text) {
      log("ERR", "Payload sem 'from' ou 'text'", { body: req.body, raw: req.rawBody?.slice?.(0, 500) });
      return res.sendStatus(200);
    }

    log("OK", `Mensagem recebida de ${from}: ${text}`);

    // respostas simples
    let reply = "🟢 FUNCIONANDO! Assistente de dieta ativo. Como posso ajudar?";
    const t = text.trim().toLowerCase();
    if (["oi", "olá", "ola", "hi", "hello"].includes(t)) {
      reply = "👋 Oi! Diga seu objetivo (perder peso, ganhar massa, manter).";
    } else if (t.includes("cardápio") || t.includes("cardapio")) {
      reply = "📋 Posso montar um cardápio básico. Quais seus horários e restrições?";
    }

    await sendMessage(from, reply);
    return res.sendStatus(200);
  } catch (e) {
    log("ERR", "Erro no webhook", { msg: e?.message });
    return res.sendStatus(200); // evitar retries
  }
});

// Start
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  console.log(`🔔 Provider: 360dialog | Endpoint: ${CLOUD_API_URL} | Phone ID: ${PHONE_NUMBER_ID || "-"}`);
  if (!CLOUD_API_TOKEN) console.log("🟨 ATENÇÃO: CLOUD_API_TOKEN/D360_API_KEY não configurado!");
});
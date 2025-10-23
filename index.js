// index.js
// WhatsApp Bot via 360dialog (sem axios, usando fetch nativo)
// Testado: responde automaticamente quando recebe mensagens

import express from "express";

const PORT = process.env.PORT || 8080;
const CLOUD_API_TOKEN = (process.env.CLOUD_API_TOKEN || process.env.D360_API_KEY || "").trim();

// URL fixa da 360dialog (NÃO é Meta Graph!)
const CLOUD_API_URL = "https://waba-v2.360dialog.io/v1/messages";

const app = express();
app.use(express.json({ verify: (req, _res, buf) => (req.rawBody = buf?.toString?.() || "") }));

// ===== Função de log bonita =====
const log = (tag, msg, extra) => {
  const icon = tag === "ERR" ? "🟥" : tag === "OK" ? "🟩" : tag === "IN" ? "🟦" : "ℹ️";
  console.log(`${icon} ${msg}`, extra ? (typeof extra === "string" ? extra : JSON.stringify(extra)) : "");
};

// ===== Healthcheck =====
app.get("/", (_req, res) => {
  res.status(200).send({
    status: "ok",
    provider: "360dialog",
    url: CLOUD_API_URL,
  });
});

// ===== Envio de mensagem (via 360dialog) =====
async function sendMessage(to, textBody) {
  const payload = {
    to,
    type: "text",
    text: { body: textBody },
  };

  const headers = {
    "Content-Type": "application/json",
    "D360-API-KEY": CLOUD_API_TOKEN,
  };

  try {
    const response = await fetch(CLOUD_API_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    const bodyText = await response.text();
    let data;
    try {
      data = JSON.parse(bodyText);
    } catch {
      data = bodyText;
    }

    if (!response.ok) {
      log("ERR", `Falha no envio (${response.status})`, data);
      throw new Error(`Erro no envio: ${response.status} ${bodyText}`);
    }

    log("OK", "Mensagem enviada com sucesso", data);
    return data;
  } catch (error) {
    log("ERR", "Erro ao enviar mensagem", error.message);
  }
}

// ===== Webhook (mensagem recebida do WhatsApp) =====
app.post("/webhook", async (req, res) => {
  log("IN", "Webhook recebido");

  try {
    const message = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    const from = message?.from?.toString?.() || "";
    const text = message?.text?.body || "";

    if (!from || !text) {
      log("ERR", "Webhook sem 'from' ou 'text'", req.body);
      return res.sendStatus(200);
    }

    log("OK", `Mensagem recebida de ${from}: ${text}`);

    // ===== Resposta automática =====
    let reply = "🟢 Funcionando! Kali ativa e conectada 💬";
    const t = text.trim().toLowerCase();

    if (["oi", "olá", "ola", "hi", "hello"].includes(t)) {
      reply = "👋 Oi! Eu sou a Kali, sua assistente de nutrição. Como posso te ajudar hoje?";
    } else if (t.includes("cardápio") || t.includes("cardapio")) {
      reply = "📋 Me conte seus horários e restrições, e eu monto um cardápio básico pra você.";
    } else if (t.includes("tirzepatida")) {
      reply = "💉 A tirzepatida é um excelente apoio no emagrecimento, mas precisa de acompanhamento médico. Deseja agendar uma consulta?";
    }

    await sendMessage(from, reply);
    res.sendStatus(200);
  } catch (error) {
    log("ERR", "Falha ao processar webhook", error.message);
    res.sendStatus(200);
  }
});

// ===== Inicialização =====
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  console.log(`🔔 Provider: 360dialog`);
  if (!CLOUD_API_TOKEN) console.log("⚠️ ATENÇÃO: CLOUD_API_TOKEN (D360-API-KEY) não configurado!");
});
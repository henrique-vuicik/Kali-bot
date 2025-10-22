// index.js
// Bot WhatsApp via 360dialog — responde texto simples "Oi" etc.

import express from "express";
import axios from "axios";

// ====== Config (.env no Railway) ======
const PORT = process.env.PORT || 8080;

// Use SEMPRE o endpoint da 360
const CLOUD_API_URL =
  (process.env.CLOUD_API_URL || "https://waba-v2.360dialog.io").trim();

// Token = sua D360-API-KEY (no painel da 360dialog)
const CLOUD_API_TOKEN =
  (process.env.CLOUD_API_TOKEN || process.env.D360_API_KEY || "").trim();

// (Opcional) só para logs; 360 não exige phone_id no envio /messages
const PHONE_NUMBER_ID = (process.env.PHONE_NUMBER_ID || "").trim();

// ====== App ======
const app = express();
// guarda o rawBody apenas para debug (não é obrigatório)
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf?.toString?.() || "";
    },
  })
);

// ---- Logger simpático
function log(tag, msg, extra) {
  const emoji =
    tag === "ERR" ? "🟥" : tag === "OK" ? "🟩" : tag === "IN" ? "🟦" : "ℹ️";
  const base = `${emoji} ${msg}`;
  if (extra) {
    try {
      console.log(base, typeof extra === "string" ? extra : JSON.stringify(extra));
    } catch {
      console.log(base);
    }
  } else {
    console.log(base);
  }
}

// ---- Healthcheck
app.get("/", (_req, res) => {
  res.status(200).send({
    status: "ok",
    provider: "360dialog",
    phone_number_id: PHONE_NUMBER_ID || undefined,
    url: CLOUD_API_URL,
  });
});

// ---- Função de envio pela 360dialog
async function sendMessage(to, body) {
  const url = `${CLOUD_API_URL}/messages`;

  const payload = {
    to,                 // número do cliente (ex.: "554299401345")
    type: "text",
    text: { body },     // texto simples
  };

  const headers = {
    "Content-Type": "application/json",
    "D360-API-KEY": CLOUD_API_TOKEN, // <<< chave da 360dialog
  };

  try {
    const rsp = await axios.post(url, payload, { headers, timeout: 20000 });
    log("OK", "Mensagem enviada com sucesso!", rsp.data);
    return rsp.data;
  } catch (err) {
    const data = err?.response?.data || err.message;
    log("ERR", "Erro ao enviar mensagem", data);
    throw err;
  }
}

// ---- Webhook de entrada (Meta → seu servidor)
app.post("/webhook", async (req, res) => {
  log("IN", "Webhook recebido");

  try {
    // Estrutura padrão de entrada da Cloud API/360 (entry -> changes -> value -> messages[0])
    const message =
      req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0] || null;

    const from = message?.from?.toString?.() || "";
    const text = message?.text?.body || "";

    if (!from || !text) {
      log("ERR", "Payload sem 'from' ou sem 'text'", {
        body: req.body,
        raw: req.rawBody?.slice?.(0, 500),
      });
      // Sempre 200 para não reentregar
      return res.sendStatus(200);
    }

    log("OK", `Mensagem recebida de ${from}: ${text}`);

    // Regras bem simples (resposta eco / saudação)
    let resposta =
      "🟢 FUNCIONANDO! Assistente de dieta ativo. Como posso ajudar na sua alimentação?";
    const t = text.trim().toLowerCase();

    if (["oi", "olá", "ola", "hello", "hi"].includes(t)) {
      resposta =
        "👋 Oi! Eu sou seu assistente de dieta. Me diga seu objetivo (ex.: perder peso, ganhar massa, manter).";
    } else if (t.includes("cardápio") || t.includes("cardapio")) {
      resposta =
        "📋 Posso montar um cardápio básico. Me diga sua rotina (horários) e restrições/alergias.";
    }

    await sendMessage(from, resposta);

    return res.sendStatus(200);
  } catch (error) {
    log("ERR", "Falha no processamento do webhook", {
      msg: error?.message,
      data: error?.response?.data,
    });
    // Retorne 200 para evitar retries infinitos do provedor
    return res.sendStatus(200);
  }
});

// ---- Start
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  console.log(
    `🔔 Provider: 360dialog | Endpoint: ${CLOUD_API_URL} | Phone ID: ${PHONE_NUMBER_ID || "-"}`
  );
  if (!CLOUD_API_TOKEN) {
    console.log("🟨 ATENÇÃO: CLOUD_API_TOKEN (D360-API-KEY) não configurado!");
  }
});
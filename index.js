// index.js — versão final (Cloud API v2 360dialog)
// Corrigido para usar o endpoint: https://waba-v2.360dialog.io/v1/{PHONE_NUMBER_ID}/messages

import express from "express";

const app = express();
app.use(express.json());

// ===== VARIÁVEIS DE AMBIENTE =====
const D360_API_KEY     = process.env.D360_API_KEY || process.env.API_KEY || "";
const BASE_URL         = (process.env.BASE_URL || "https://waba-v2.360dialog.io/").trim();
const PHONE_NUMBER_ID  = process.env.PHONE_NUMBER_ID || "";
const PORT             = process.env.PORT || 8080;

// Normaliza BASE_URL (garante barra no final)
const BASE = BASE_URL.endsWith("/") ? BASE_URL : BASE_URL + "/";

// ✅ Endpoint correto (com número na URL)
const V2_SEND_URL = `${BASE}v1/${PHONE_NUMBER_ID}/messages`;

// ===== FUNÇÃO AUXILIAR =====
async function safeJson(resp) {
  try { return await resp.json(); } catch { return await resp.text(); }
}

// ===== LOG SIMPLES =====
const log = (lvl, msg, extra) => {
  const tag = lvl === "err" ? "🟥" : "✅";
  console.log(`${tag} ${msg}`, extra ? JSON.stringify(extra, null, 2) : "");
};

// ===== ROTA PRINCIPAL =====
app.get("/", (_, res) => {
  res.json({
    ok: true,
    version: "v2-final",
    BASE_URL: BASE,
    PHONE_NUMBER_ID,
    has_API_KEY: !!D360_API_KEY,
    PORT: String(PORT)
  });
});

// ===== ROTA DE TESTE DIRETO =====
// Teste no navegador: /debug/send?to=554299401345&text=teste
app.get("/debug/send", async (req, res) => {
  const to = (req.query.to || "").toString();
  const text = (req.query.text || "").toString();

  if (!to || !text) return res.status(400).json({ ok: false, error: "Faltou 'to' ou 'text'" });
  if (!D360_API_KEY || !PHONE_NUMBER_ID) return res.status(400).json({ ok: false, error: "Faltam envs" });

  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: text }
  };

  try {
    const r = await fetch(V2_SEND_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "D360-API-KEY": D360_API_KEY
      },
      body: JSON.stringify(payload)
    });

    const data = await safeJson(r);
    if (!r.ok) {
      log("err", `360 DEBUG: HTTP ${r.status}`, { url: V2_SEND_URL, payload, response: data });
      return res.status(r.status).json({ ok: false, status: r.status, response: data });
    }

    log("ok", "Mensagem enviada com sucesso!", data);
    res.json({ ok: true, response: data });
  } catch (e) {
    log("err", "Erro ao enviar mensagem", e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// ===== WEBHOOK =====
app.post("/webhook", async (req, res) => {
  try {
    const msg = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    const from = msg?.from;
    const text = msg?.text?.body;

    if (!text || !from) {
      log("err", "Webhook recebido sem texto ou número");
      return res.sendStatus(200);
    }

    log("ok", `Mensagem recebida de ${from}: ${text}`);

    const payload = {
      messaging_product: "whatsapp",
      to: from,
      type: "text",
      text: { body: `Oi! Recebi: ${text}` }
    };

    const r = await fetch(V2_SEND_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "D360-API-KEY": D360_API_KEY
      },
      body: JSON.stringify(payload)
    });

    const data = await safeJson(r);
    if (!r.ok) {
      log("err", `Erro ao responder (${r.status})`, data);
    } else {
      log("ok", `Mensagem respondida com sucesso!`, data);
    }

    res.sendStatus(200);
  } catch (e) {
    log("err", "Exceção no webhook", e);
    res.sendStatus(200);
  }
});

// ===== INICIA SERVIDOR =====
app.listen(PORT, () => {
  console.log(`🚀 Kali-bot rodando na porta ${PORT}`);
});

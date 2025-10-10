// index.js
// Servidor mínimo para Webhook 360dialog (Cloud API hosted by Meta) + fallback clássico
// Node 18+ (fetch nativo). Procfile: `web: node index.js`

import express from "express";

// ---------- ENV ----------
const PORT = process.env.PORT || 8080;

// Se você preferir outros nomes, ajuste aqui:
const API_KEY        = process.env.D360_API_KEY;                // Obrigatório
const BASE_URL       = (process.env.D360_BASE_URL || "https://waba-v2.360dialog.io").trim(); // Obrigatório
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID || process.env.WABA_CHANNEL_EXTERNAL_ID; // Para modo Cloud API
const FROM_NUMBER     = process.env.FROM_NUMBER;                // Para modo clássico

// ---------- APP ----------
const app = express();
app.use(express.json({ limit: "1mb" }));

// ---------- LOG UTILS ----------
const log = (...args) => console.log(...args);
const err = (...args) => console.error(...args);

// ---------- HEALTH / DEBUG ----------
app.get("/", (_req, res) => {
  res.type("application/json").send(
    JSON.stringify(
      {
        has_API_KEY: !!API_KEY,
        BASE_URL,
        PHONE_NUMBER_ID: PHONE_NUMBER_ID || null,
        FROM_NUMBER: FROM_NUMBER || null,
        PORT: String(PORT),
      },
      null,
      2
    )
  );
});

app.get("/health", (_req, res) => res.send("ok"));

// ---------- ENVIAR MENSAGEM (Cloud API -> fallback clássico) ----------
async function sendTextVia360(to, text) {
  if (!API_KEY || !BASE_URL) {
    throw new Error("Faltam envs: D360_API_KEY ou D360_BASE_URL");
  }
  const base = BASE_URL.replace(/\/+$/, "");
  const headersJson = { "Content-Type": "application/json", Accept: "application/json" };

  // 1) Tenta modo Cloud API (proxy v2)
  try {
    if (!PHONE_NUMBER_ID) throw new Error("Sem PHONE_NUMBER_ID para modo Cloud API");

    const urlCloud = `${base}/v1/${PHONE_NUMBER_ID}/messages`;
    const payloadCloud = {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text },
      preview_url: false,
    };

    const r1 = await fetch(urlCloud, {
      method: "POST",
      headers: { ...headersJson, Authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify(payloadCloud),
    });

    const body1 = await r1.text();
    if (r1.ok) {
      log(`✅ 360 Cloud API OK: ${body1}`);
      try { return JSON.parse(body1); } catch { return { ok: true, raw: body1 }; }
    } else {
      err(`🛑 360 (Cloud API) HTTP ${r1.status} - ${body1}`);
      if (r1.status >= 400 && r1.status < 500) throw new Error("fallback");
      throw new Error(`Cloud API falhou: ${r1.status} - ${body1}`);
    }
  } catch (e) {
    if (String(e.message) !== "fallback") {
      log(`ℹ️ pulando para modo clássico: ${e.message}`);
    }
  }

  // 2) Fallback: modo 360 clássico (header D360-API-KEY + body com 'from')
  if (!FROM_NUMBER) throw new Error("Sem FROM_NUMBER para modo clássico");

  const urlClassic = `${base}/v1/messages`;
  const payloadClassic = { from: FROM_NUMBER, to, type: "text", text: { body: text } };

  const r2 = await fetch(urlClassic, {
    method: "POST",
    headers: { ...headersJson, "D360-API-KEY": API_KEY },
    body: JSON.stringify(payloadClassic),
  });

  const body2 = await r2.text();
  if (r2.ok) {
    log(`✅ 360 clássico OK: ${body2}`);
    try { return JSON.parse(body2); } catch { return { ok: true, raw: body2 }; }
  }
  throw new Error(`360 clássico HTTP ${r2.status} - ${body2}`);
}

// ---------- PARSE DO WEBHOOK ----------
/*
Suportamos:
1) Estilo Cloud API (body.object == "whatsapp_business_account")
   body.entry[].changes[].value.messages[]  com .from e .text.body
2) Estilo 360 clássico de exemplos (body.messages[] direto)
*/
function extractIncomingMessages(body) {
  const out = [];

  // Estilo Cloud API
  if (body && body.object === "whatsapp_business_account" && Array.isArray(body.entry)) {
    for (const ent of body.entry) {
      if (!ent.changes) continue;
      for (const ch of ent.changes) {
        const v = ch.value || {};
        const messages = v.messages || [];
        for (const m of messages) {
          const from = m.from;
          const txt = m.text?.body;
          if (from && typeof txt === "string" && txt.length) {
            out.push({ from, text: txt });
          }
        }
      }
    }
  }

  // Estilo 360 “simples”
  if (Array.isArray(body?.messages)) {
    for (const m of body.messages) {
      const from = m.from;
      const txt = m.text?.body;
      if (from && typeof txt === "string" && txt.length) {
        out.push({ from, text: txt });
      }
    }
  }

  return out;
}

// ---------- WEBHOOK ----------
app.post("/webhook", async (req, res) => {
  try {
    const msgs = extractIncomingMessages(req.body);

    if (!msgs.length) {
      log("ℹ️ webhook recebido, mas sem texto ou sem 'from'.");
      return res.sendStatus(200);
    }

    // Processa cada mensagem textual recebida
    for (const { from, text } of msgs) {
      log(`💬 msg de ${from}: "${text}"`);

      try {
        const reply = `Recebido: ${text}`;
        await sendTextVia360(from, reply);
      } catch (e) {
        err(`🛑 erro ao responder ${from}: ${e?.message || e}`);
      }
    }

    res.sendStatus(200);
  } catch (e) {
    err("❌ erro no webhook:", e);
    res.sendStatus(500);
  }
});

// ---------- START ----------
app.listen(PORT, () => {
  log(`🚀 listening :${PORT}`);
});

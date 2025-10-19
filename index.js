// index.js — v2 360dialog com DEBUG detalhado

import express from "express";
const app = express();
app.use(express.json());

// ===== ENV =====
const D360_API_KEY    = process.env.D360_API_KEY || process.env.API_KEY || "";
const BASE_URL_RAW    = process.env.BASE_URL || "https://waba-v2.360dialog.io/";
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID || "";
const PORT            = process.env.PORT || 8080;

// normaliza BASE_URL
const BASE = BASE_URL_RAW.endsWith("/") ? BASE_URL_RAW : BASE_URL_RAW + "/";
// endpoint v2 correto
const V2_SEND_URL = `${BASE}v1/${PHONE_NUMBER_ID}/messages`;

// helpers
async function safeJson(res) {
  try { return await res.json(); } catch { try { return await res.text(); } catch { return null; } }
}
const log = (lvl, msg, extra) => {
  const tag = lvl === "err" ? "🟥" : lvl === "warn" ? "🟧" : lvl === "dbg" ? "🟦" : "🟩";
  console.log(`${tag} ${msg}`, extra ? (typeof extra === "string" ? extra : JSON.stringify(extra, null, 2)) : "");
};

// health
app.get("/", (_, res) => {
  res.json({
    ok: true,
    using_360_v2: true,
    BASE_URL: BASE,
    has_API_KEY: !!D360_API_KEY,
    PHONE_NUMBER_ID,
    PORT: String(PORT)
  });
});

// debug manual: /debug/send?to=554299401345&text=Oi
app.get("/debug/send", async (req, res) => {
  const to = (req.query.to || "").toString();
  const text = (req.query.text || "").toString();
  if (!to || !text) return res.status(400).json({ ok:false, error:"Faltou 'to' ou 'text'" });
  if (!D360_API_KEY || !PHONE_NUMBER_ID) return res.status(400).json({ ok:false, error:"Faltam envs (D360_API_KEY/PHONE_NUMBER_ID)" });

  const payload = { messaging_product:"whatsapp", to, type:"text", text:{ body:text } };
  const headers = { "Content-Type":"application/json", "D360-API-KEY": D360_API_KEY };

  try {
    log("dbg", "360 REQUEST", { url: V2_SEND_URL, headers: { ...headers, "D360-API-KEY":"<hidden>" }, payload });
    const r = await fetch(V2_SEND_URL, { method:"POST", headers, body: JSON.stringify(payload) });
    const body = await safeJson(r);
    if (!r.ok) {
      log("err", `360 DEBUG: HTTP ${r.status}`, { url: V2_SEND_URL, response_body: body });
      return res.status(r.status).json({ ok:false, status:r.status, response: body });
    }
    log("ok", "Mensagem enviada (debug/send)", body);
    res.json({ ok:true, response: body });
  } catch (e) {
    log("err", "Exceção no debug/send", String(e));
    res.status(500).json({ ok:false, error:String(e) });
  }
});

// webhook do 360 (Cloud API)
app.post("/webhook", async (req, res) => {
  try {
    const value = req.body?.entry?.[0]?.changes?.[0]?.value;
    const msg   = value?.messages?.[0];
    const from  = msg?.from;
    const text  = msg?.text?.body;

    if (!from || !text) {
      log("warn", "Webhook sem from/text — ignorando");
      return res.sendStatus(200);
    }

    log("dbg", "msg IN", { from, text });

    // resposta simples
    const payload = { messaging_product:"whatsapp", to: from, type:"text", text:{ body:`Eco: ${text}` } };
    const headers = { "Content-Type":"application/json", "D360-API-KEY": D360_API_KEY };

    if (!D360_API_KEY || !PHONE_NUMBER_ID) {
      log("err", "Faltam envs para responder", { hasKey: !!D360_API_KEY, PHONE_NUMBER_ID });
      return res.sendStatus(200);
    }

    log("dbg", "360 REQUEST (reply)", { url: V2_SEND_URL, headers: { ...headers, "D360-API-KEY":"<hidden>" }, payload });
    const r = await fetch(V2_SEND_URL, { method:"POST", headers, body: JSON.stringify(payload) });
    const body = await safeJson(r);

    if (!r.ok) {
      log("err", `Erro ao responder (${r.status})`, body);
    } else {
      log("ok", "Resposta enviada", body);
    }
    res.sendStatus(200);
  } catch (e) {
    log("err", "Exceção no /webhook", String(e));
    res.sendStatus(200);
  }
});

app.listen(PORT, () => console.log(`🚀 listening :${PORT}`));

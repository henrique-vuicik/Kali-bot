// index.js
// Bot de eco ultra-simples para 360dialog (Cloud API hosted by Meta)

import express from "express";

// ======= ENV =======
const {
  API_KEY,            // seu API Key do 360 (obrigatório)
  BASE_URL,           // ex: https://waba-v2.360dialog.io  (sem barra final)
  PHONE_NUMBER_ID,    // WABA Channel External ID (ex: 884962384692953)
  FROM_NUMBER,        // ex: 554291251751 (formato E.164, sem +)
  PORT = 8080,
} = process.env;

// ======= APP =======
const app = express();
app.use(express.json());

// Logs simples de boot
app.listen(PORT, () => {
  console.log(`🚀 listening :${PORT}`);
});

// Healthchecks
app.get("/", (_req, res) => res.status(200).type("text").send("OK"));
app.get("/webhook", (_req, res) => res.status(200).send("OK"));

// Expor envs para conferência (sem vazar o API_KEY)
app.get("/vars", (_req, res) => {
  res.json({
    has_API_KEY: Boolean(API_KEY && API_KEY.length > 5),
    BASE_URL,
    PHONE_NUMBER_ID,
    FROM_NUMBER,
    PORT: String(PORT),
  });
});

// ========== helpers ==========
function getTextAndFromFrom360Payload(body) {
  // cobre os dois formatos que vimos nos seus logs

  // 1) Formato “teste”/legado do 360 (messages/contacts na raiz)
  if (body?.messages && Array.isArray(body.messages) && body.messages[0]) {
    const msg = body.messages[0];
    const from = msg.from || body?.contacts?.[0]?.wa_id;
    const text = msg.text?.body;
    if (from && text) return { from, text };
  }

  // 2) Formato “Cloud API hosted by Meta” (object/entry/changes…)
  if (body?.object === "whatsapp_business_account" && Array.isArray(body.entry)) {
    try {
      const change = body.entry[0]?.changes?.[0]?.value;
      const msg = change?.messages?.[0];
      const from = msg?.from || change?.contacts?.[0]?.wa_id;
      const text = msg?.text?.body;
      if (from && text) return { from, text };
    } catch (_) {}
  }

  return null;
}

async function sendTextVia360(to, text) {
  if (!API_KEY || !BASE_URL || !PHONE_NUMBER_ID) {
    throw new Error("Faltam envs: API_KEY, BASE_URL ou PHONE_NUMBER_ID");
  }

  const url = `${BASE_URL.replace(/\/+$/, "")}/v1/${PHONE_NUMBER_ID}/messages`;

  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: text },
  };

  const headers = {
    // alguns ambientes do 360 exigem explicitamente o header D360-API-KEY,
    // outros aceitam Authorization Bearer; mandamos os dois.
    Authorization: `Bearer ${API_KEY}`,
    "D360-API-KEY": API_KEY,
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  const r = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  const data = await r.json().catch(() => ({}));

  if (!r.ok) {
    const msg = typeof data === "object" ? JSON.stringify(data) : String(data);
    throw new Error(`HTTP ${r.status} - ${msg}`);
  }

  return data;
}

// ========== webhook ==========
app.post("/webhook", async (req, res) => {
  // sempre responde 200 rápido para evitar reentrega
  res.status(200).json({ ok: true });

  const parsed = getTextAndFromFrom360Payload(req.body);
  if (!parsed) {
    console.log("ℹ️ payload não contém texto/from processável");
    return;
  }

  const { from, text } = parsed;
  console.log(`💬 msg de ${from}: "${text}"`);

  try {
    const reply = `Echo: ${text}`;
    const result = await sendTextVia360(from, reply);
    console.log("✅ 360 ok:", JSON.stringify(result));
  } catch (err) {
    console.error("🛑 360 erro:", err?.message || err);
  }
});

// Tratamento de erro de JSON inválido (caso 360 mande algo estranho)
app.use((err, _req, res, _next) => {
  console.error("🛑 erro middleware:", err?.message || err);
  res.status(200).json({ ok: true });
});

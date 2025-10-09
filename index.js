const express = require("express");
const axios = require("axios");

const PORT = process.env.PORT || 8080;

// ===== helpers =====
const getD360 = () =>
  process.env.D360_API_KEY ||
  process.env.D360_API_TOKEN ||
  process.env.D360_API ||
  process.env.DIALOG360_API_KEY ||
  process.env.DIALOG360_TOKEN ||
  process.env.D360;

function changeValue(body) {
  try {
    const e = body?.entry?.[0];
    const c = e?.changes?.[0];
    return c?.value ?? c;
  } catch {
    return undefined;
  }
}

function pickText(body) {
  const v = changeValue(body);
  const m = v?.messages?.[0];
  if (!m) return null;
  if (m.text?.body) return m.text.body;
  if (m.button?.text) return m.button.text;
  const i = m.interactive;
  if (i?.button_reply?.title) return i.button_reply.title;
  if (i?.list_reply?.title) return i.list_reply.title;
  return null;
}

function pickNumber(body) {
  const v = changeValue(body);
  const m = v?.messages?.[0];
  if (m?.from) return String(m.from).trim();
  const c = v?.contacts?.[0];
  if (c?.wa_id) return String(c.wa_id).trim();
  const s = v?.statuses?.[0];
  if (s?.recipient_id) return String(s.recipient_id).trim();

  // fallback bruto no JSON inteiro
  const raw = JSON.stringify(body);
  let hit =
    raw.match(/"wa_id"\s*:\s*"(\d{6,20})"/) ||
    raw.match(/"from"\s*:\s*"(\d{6,20})"/) ||
    raw.match(/"recipient_id"\s*:\s*"(\d{6,20})"/);
  if (hit?.[1]) return hit[1];

  hit = raw.match(/"(\d{6,20})"/);
  if (hit?.[1]) return hit[1];

  return null;
}

async function reply360(to, text) {
  const token = getD360();
  if (!token) {
    console.log("⚠️  D360 token ausente nas variáveis de ambiente.");
    return;
  }
  try {
    await axios.post(
      "https://waba.360dialog.io/v1/messages",
      { to, type: "text", text: { body: text } },
      { headers: { "Content-Type": "application/json", "D360-API-KEY": token }, timeout: 10000 }
    );
    console.log(`✅ enviado p/ ${to}`);
  } catch (err) {
    console.log("❌ erro 360:", err?.response?.data || err.message);
  }
}

// ===== app =====
const app = express();

// coletor de corpo cru (qualquer content-type)
app.use((req, res, next) => {
  let chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const buf = Buffer.concat(chunks);
    req.rawBody = buf.toString("utf8");
    try {
      if (req.rawBody && req.headers["content-type"]?.includes("application/json")) {
        req.body = JSON.parse(req.rawBody);
      }
    } catch {
      // deixa sem body se não for JSON válido
    }
    next();
  });
});

// log global de TODA request
app.use((req, _res, next) => {
  const h = req.headers || {};
  const keyHdrs = {
    "x-forwarded-for": h["x-forwarded-for"],
    "content-type": h["content-type"],
    "user-agent": h["user-agent"]
  };
  const raw = req.rawBody || "";
  console.log(
    `📥 ${req.method} ${req.path} | hdrs=${JSON.stringify(keyHdrs)} | raw(0..800)= ${raw.slice(
      0,
      800
    )}${raw.length > 800 ? "…" : ""}`
  );
  next();
});

// health/simple
app.get("/", (_req, res) => res.status(200).send("ok"));
app.get("/webhook", (_req, res) => res.status(200).send("ok"));

// webhook principal
app.post("/webhook", async (req, res) => {
  const body = req.body ?? {};
  console.log(
    `🔎 flags -> msgs:${/"messages"\s*:\s*\[/.test(JSON.stringify(body))} contacts:${/"contacts"\s*:\s*\[/.test(
      JSON.stringify(body)
    )} statuses:${/"statuses"\s*:\s*\[/.test(JSON.stringify(body))}`
  );

  let number = null;
  let text = null;
  try {
    number = pickNumber(body);
    text = pickText(body);
  } catch (e) {
    console.log("parser error:", e?.message || e);
  }

  if (!number) {
    console.log("❌ Nenhum número encontrado (mesmo após fallback)");
    return res.status(200).send("ok");
  }

  console.log(`👤 numero=${number}${text ? " | texto=" + JSON.stringify(text) : ""}`);

  if (text) {
    await reply360(number, "Recebi sua mensagem 👍");
  }

  return res.status(200).send("ok");
});

// pega qq rota p/ garantir log mesmo se URL estiver errada
app.all("*", (_req, res) => res.status(200).send("ok"));

app.listen(PORT, () => console.log(`🚀 Kali server listening on :${PORT}`));

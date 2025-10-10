// index.js (ESM)
import express from "express";
import axios from "axios";

const app = express();
app.use(express.json({ limit: "2mb" }));

const PORT = process.env.PORT || 8080;

// pega o token da 360 em qualquer nome comum
const getD360 = () =>
  process.env.D360_API_KEY ||
  process.env.D360_API_TOKEN ||
  process.env.D360_API ||
  process.env.DIALOG360_API_KEY ||
  process.env.DIALOG360_TOKEN ||
  process.env.D360;

const changeValue = (b) => {
  try {
    const e = b?.entry?.[0];
    const c = e?.changes?.[0];
    return c?.value ?? c;
  } catch {
    return undefined;
  }
};

const pickText = (b) => {
  const v = changeValue(b);
  const m = v?.messages?.[0];
  if (!m) return null;
  if (m.text?.body) return m.text.body;
  if (m.button?.text) return m.button.text;
  const i = m.interactive;
  if (i?.button_reply?.title) return i.button_reply.title;
  if (i?.list_reply?.title) return i.list_reply.title;
  return null;
};

const pickNumber = (b) => {
  const v = changeValue(b);
  const m = v?.messages?.[0];
  if (m?.from) return String(m.from).trim();
  const c = v?.contacts?.[0];
  if (c?.wa_id) return String(c.wa_id).trim();
  const s = v?.statuses?.[0];
  if (s?.recipient_id) return String(s.recipient_id).trim();

  // Fallback bruto no JSON
  const raw = JSON.stringify(b);
  let hit =
    raw.match(/"wa_id"\s*:\s*"(\d{6,20})"/) ||
    raw.match(/"from"\s*:\s*"(\d{6,20})"/) ||
    raw.match(/"recipient_id"\s*:\s*"(\d{6,20})"/);
  if (hit?.[1]) return hit[1];

  hit = raw.match(/"(\d{6,20})"/);
  if (hit?.[1]) return hit[1];

  return null;
};

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

// Health
app.get("/", (_req, res) => res.status(200).send("ok"));
app.get("/health", (_req, res) => res.status(200).send("ok"));

// Webhook
app.post("/webhook", async (req, res) => {
  try {
    const raw = JSON.stringify(req.body);
    console.log(
      `📥 POST /webhook | flags msgs:${/"messages"\s*:\s*\[/.test(raw)} contacts:${/"contacts"\s*:\s*\[/.test(
        raw
      )} statuses:${/"statuses"\s*:\s*\[/.test(raw)}`
    );
    console.log(`🔎 raw(0..400): ${raw.slice(0, 400)}${raw.length > 400 ? "…" : ""}`);

    const number = pickNumber(req.body);
    const text = pickText(req.body);

    if (!number) {
      console.log("❌ Nenhum número encontrado");
      return res.status(200).send("ok");
    }

    console.log(`👤 numero=${number}${text ? " | texto=" + JSON.stringify(text) : ""}`);

    if (text) {
      await reply360(number, `Recebi: ${text}`);
    }

    return res.status(200).send("ok");
  } catch (e) {
    console.log("💥 erro handler:", e?.message || e);
    return res.status(200).send("ok");
  }
});

app.listen(PORT, () => console.log(`🚀 Kali server listening on :${PORT}`));

import express from "express";

const app = express();
app.use(express.json());

const D360_API_KEY    = process.env.D360_API_KEY || process.env.API_KEY || "";
const BASE_URL        = (process.env.BASE_URL || "https://waba-v2.360dialog.io/").trim();
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID || "";
const PORT            = process.env.PORT || 8080;

const BASE = BASE_URL.endsWith("/") ? BASE_URL : BASE_URL + "/";
const V2_SEND_URL = `${BASE}v1/${PHONE_NUMBER_ID}/messages`;

async function safeJson(res) {
  try { return await res.json(); } catch { return await res.text(); }
}

const log = (lvl, msg, extra) => {
  const tag = lvl === "err" ? "🟥" : lvl === "ok" ? "✅" : "🟦";
  console.log(`${tag} ${msg}`, extra ? JSON.stringify(extra, null, 2) : "");
};

app.get("/", (_, res) => {
  res.json({
    ok: true,
    BASE_URL: BASE,
    PHONE_NUMBER_ID,
    has_API_KEY: !!D360_API_KEY,
    PORT
  });
});

app.post("/webhook", async (req, res) => {
  try {
    const msg = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    const from = msg?.from;
    const text = msg?.text?.body;
    if (!from || !text) return res.sendStatus(200);

    log("ok", `msg IN ${from}: ${text}`);

    const payload = {
      messaging_product: "whatsapp",
      to: from,
      type: "text",
      text: { body: `Eco: ${text}` }
    };

    const headers = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${D360_API_KEY}` // ✅ Novo formato correto
    };

    log("🟦", "Enviando...", { url: V2_SEND_URL, payload });

    const r = await fetch(V2_SEND_URL, { method: "POST", headers, body: JSON.stringify(payload) });
    const data = await safeJson(r);

    if (!r.ok) {
      log("err", `Erro ${r.status}`, data);
    } else {
      log("ok", "Mensagem enviada!", data);
    }

    res.sendStatus(200);
  } catch (e) {
    log("err", "Exceção no webhook", e);
    res.sendStatus(200);
  }
});

app.listen(PORT, () => console.log(`🚀 Kali-bot rodando na porta ${PORT}`));

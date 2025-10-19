import express from "express";

// ====== ENV ======
const PORT = process.env.PORT || 8080;
const BASE_URL = (process.env.BASE_URL || "https://waba-v2.360dialog.io/").trim().replace(/\/+$/, "/");
const D360_API_KEY = process.env.D360_API_KEY?.trim() || "";
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID?.trim() || "";
const FROM_NUMBER = (process.env.FROM_NUMBER || "").trim(); // vamos deixar OPCIONAL

const app = express();
app.use(express.json({ limit: "1mb" }));

// Health/debug
app.get("/", (_req, res) => {
  res.json({
    ok: true,
    using_360_v2: true,
    BASE_URL,
    has_API_KEY: Boolean(D360_API_KEY),
    PHONE_NUMBER_ID,
    has_FROM_NUMBER: Boolean(FROM_NUMBER),
    PORT
  });
});

// ====== helpers ======
function url360(path) {
  return BASE_URL + path.replace(/^\//, "");
}

async function send360Text(to, textBody) {
  if (!D360_API_KEY || !BASE_URL) {
    throw new Error("Faltam envs: D360_API_KEY ou BASE_URL");
  }

  // Payload “Cloud API-like” aceito pelo 360 v2
  const payload = {
    messaging_product: "whatsapp",
    to: String(to),
    type: "text",
    text: { body: String(textBody) }
  };

  // ⚠️ Muitos canais rejeitam quando incluímos "from". Teste PRIMEIRO SEM.
  if (FROM_NUMBER) {
    // Se precisar muito, descomente a linha abaixo:
    // payload.from = FROM_NUMBER;
  }

  const url = url360("/v1/messages");
  const hdrs = {
    "Content-Type": "application/json",
    "D360-API-KEY": D360_API_KEY
  };

  const res = await fetch(url, { method: "POST", headers: hdrs, body: JSON.stringify(payload) });
  const rawText = await res.text();

  // Tente parsear o corpo
  let body;
  try { body = JSON.parse(rawText); } catch { body = rawText; }

  if (!res.ok) {
    // Extraia o máximo possível para log
    const meta = body?.meta;
    const code = meta?.http_code || res.status;
    const dev = meta?.developer_message || body?.error || res.statusText || "Bad request";
    const trace = meta?.["360dialog_trace_id"];
    const details = {
      url,
      request_headers: { "Content-Type": hdrs["Content-Type"], "D360-API-KEY": "<hidden>" },
      request_body: payload,
      response_status: res.status,
      response_body: body
    };
    console.error("🟥 360 DEBUG:", JSON.stringify(details, null, 2));
    throw new Error(`360 HTTP ${code} - ${dev}${trace ? ` | trace=${trace}` : ""}`);
  }

  return body;
}

// ====== webhook ======
app.post("/webhook", async (req, res) => {
  // sempre 200 rápido
  res.sendStatus(200);

  try {
    const raw = req.body;
    let from, text;

    // Formato Cloud-API (Hosted by Meta)
    if (raw?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]) {
      const m = raw.entry[0].changes[0].value.messages[0];
      from = m.from;
      text = m.text?.body;
    }

    // Formato 360 clássico
    if (!from && raw?.messages?.[0]) {
      const m = raw.messages[0];
      from = m.from;
      text = m.text?.body;
    }

    if (!from || !text) {
      console.log("ℹ️ payload sem texto ou sem from. Nada a fazer.");
      return;
    }

    console.log(`💬 msg de ${from}: "${text}"`);

    try {
      const reply = `Recebi: "${text}" ✔︎`;
      const resp = await send360Text(from, reply);
      const meta = resp?.meta;
      console.log(`✅ enviado para ${from}${meta?.["360dialog_trace_id"] ? ` (trace ${meta["360dialog_trace_id"]})` : ""}`);
    } catch (e) {
      console.error(`🛑 erro ao responder ${from}: ${e.message}`);
    }
  } catch (e) {
    console.error("❌ Erro no webhook:", e);
  }
});

// ====== util de teste via navegador ======
// /debug/send?to=554299401345&text=Ola
app.get("/debug/send", async (req, res) => {
  const { to, text } = req.query;
  try {
    const out = await send360Text(to, text || "ping");
    res.json({ ok: true, out });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.listen(PORT, () => console.log(`🚀 listening :${PORT}`));

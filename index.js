import express from "express";

// ======= ENV & Config =======
const PORT = process.env.PORT || 8080;

// Use APENAS 360 v2
const BASE_URL = (process.env.BASE_URL || "https://waba-v2.360dialog.io/").trim().replace(/\/+$/, "/");
const D360_API_KEY = process.env.D360_API_KEY?.trim();
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID?.trim(); // não usado pelo v2, mas deixamos logado
const FROM_NUMBER = process.env.FROM_NUMBER?.trim();         // opcional no v2; usamos para consistência

const app = express();
app.use(express.json({ limit: "1mb" }));

// Raiz mostra um "health + envs úteis" (sem vazar segredo)
app.get("/", (_req, res) => {
  res.json({
    ok: true,
    using_360_v2: true,
    BASE_URL,
    has_API_KEY: Boolean(D360_API_KEY),
    PHONE_NUMBER_ID,
    FROM_NUMBER,
    PORT
  });
});

// ======= Helpers =======
function build360Url(path) {
  // garante BASE_URL com / no fim; concatena sem duplicar barras
  return BASE_URL + path.replace(/^\/+/, "");
}

async function send360Text(to, body) {
  if (!D360_API_KEY || !BASE_URL) {
    throw new Error("Faltam envs: D360_API_KEY ou BASE_URL");
  }

  const url = build360Url("/v1/messages");
  const payload = {
    to,
    type: "text",
    text: { body }
  };

  // No 360 v2 o "from" costuma ser opcional (amarrado ao canal).
  // Se quiser forçar, descomente a linha abaixo:
  if (FROM_NUMBER) payload.from = FROM_NUMBER;

  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "D360-API-KEY": D360_API_KEY
    },
    body: JSON.stringify(payload),
    // timeout de bom senso (Railway derruba muito cedo às vezes)
  });

  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }

  if (!r.ok) {
    // 360 às vezes devolve {meta:{http_code,...}}. Vamos extrair tudo que ajuda.
    const meta = (data && data.meta) ? data.meta : undefined;
    const msg = meta?.developer_message || data?.error || r.statusText || "Erro 360";
    const trace = meta?.["360dialog_trace_id"];
    const more = trace ? ` | trace_id=${trace}` : "";
    throw new Error(`360 HTTP ${meta?.http_code || r.status} - ${msg}${more}`);
  }

  return data;
}

// ======= Webhook =======
app.post("/webhook", async (req, res) => {
  try {
    // Responde rápido para não estourar timeout do 360
    res.sendStatus(200);

    const raw = req.body;
    // 360 “Hosted by Meta” envia no formato Cloud API (object/entry/changes)
    // Vamos tentar extrair texto de ambos formatos.
    let from, text;

    // Formato Cloud API-style
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

    // Resposta “ping” simples
    const reply = `Recebi: "${text}" ✔︎`;

    try {
      const resp = await send360Text(from, reply);
      const meta = resp?.meta;
      const trace = meta?.["360dialog_trace_id"];
      console.log(`✅ enviado para ${from} ${trace ? `(trace ${trace})` : ""}`);
    } catch (e) {
      console.error(`🛑 erro ao responder ${from}: ${e.message}`);
    }
  } catch (e) {
    // Se der erro ANTES do res.status(200), garantimos 200
    try { res.sendStatus(200); } catch {}
    console.error("❌ Erro no webhook:", e.message);
  }
});

// ======= Start =======
app.listen(PORT, () => {
  console.log(`🚀 listening :${PORT}`);
});

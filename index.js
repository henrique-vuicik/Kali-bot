import express from "express";

const app = express();
app.use(express.json());

// ---- ENV ----
const PORT = process.env.PORT || 8080;

// Base da 360 (padrão v2)
const D360_BASE = process.env.D360_BASE || "https://waba-v2.360dialog.io";
const D360_API_KEY = process.env.D360_API_KEY;      // obrigatória
const FROM_NUMBER = process.env.FROM_NUMBER;        // ex: 554291251751 (sem +)

// Sanidade inicial
if (!D360_API_KEY) {
  console.warn("⚠️  D360_API_KEY não definida. Resposta não será enviada.");
}
if (!FROM_NUMBER) {
  console.warn("⚠️  FROM_NUMBER não definido. Defina seu número WABA sem '+'.");
}

app.get("/health", (_req, res) => res.status(200).send("ok"));

// Util: extrai texto + remetente do payload (360 -> formato Cloud API)
function extractTextAndFrom(body) {
  try {
    if (!body || !body.entry || !Array.isArray(body.entry)) return null;
    const change = body.entry[0]?.changes?.[0]?.value;
    const msg = Array.isArray(change?.messages) ? change.messages[0] : null;
    const from = msg?.from;
    const text = msg?.text?.body;
    if (!from || !text) return null;
    return { from, text };
  } catch {
    return null;
  }
}

app.post("/webhook", async (req, res) => {
  // Responde 200 primeiro para não tomar retry do 360
  res.sendStatus(200);

  const parsed = extractTextAndFrom(req.body);
  if (!parsed) {
    console.log("ℹ️ payload sem texto ou sem from. Nada a fazer.");
    return;
  }

  const { from, text } = parsed;
  console.log(`📥 msg de ${from}: "${text}"`);

  if (!D360_API_KEY || !FROM_NUMBER) {
    console.log("⚠️ Sem credenciais FROM/API; pulando envio.");
    return;
  }

  // Mensagem de eco
  const payload = {
    from: FROM_NUMBER,          // seu número WABA
    to: from,                   // quem te enviou
    type: "text",
    text: { body: `Recebido: ${text}` }
  };

  try {
    const resp = await fetch(`${D360_BASE}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "D360-API-KEY": D360_API_KEY
      },
      body: JSON.stringify(payload)
    });

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      console.error("❌ Erro 360:", resp.status, data);
    } else {
      console.log("✅ Enviado 360:", data);
    }
  } catch (err) {
    console.error("❌ Erro ao processar:", err);
  }
});

// Shutdown gracioso (Railway)
process.on("SIGTERM", () => {
  console.log("🛑 SIGTERM recebido (Railway redeploy). Encerrando...");
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`🚀 listening :${PORT}`);
});

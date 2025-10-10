// index.js
import express from "express";

// ----- Config -----
const PORT = process.env.PORT || 8080;
const D360_API_KEY = process.env.D360_API_KEY; // OBRIGATÓRIA
const D360_BASE = (process.env.D360_BASE || "https://waba.360dialog.io").replace(/\/+$/, "");

// Util: log compacto
const j = (obj, n = 400) => JSON.stringify(obj || "").slice(0, n);

// ----- App -----
const app = express();
app.use(express.json({ limit: "2mb" }));

// Healthcheck
app.get("/", (_req, res) => res.status(200).send("OK"));

// Webhook do 360
app.post("/webhook", async (req, res) => {
  try {
    const body = req.body || {};
    // 1) Responder 200 o mais rápido possível
    res.sendStatus(200);

    // 2) Logs úteis
    console.log("📥 POST /webhook | flags",
      `msgs:${!!body?.entry?.[0]?.changes?.[0]?.value?.messages}`,
      `contacts:${!!body?.entry?.[0]?.changes?.[0]?.value?.contacts}`,
      `statuses:${!!body?.entry?.[0]?.changes?.[0]?.value?.statuses}`
    );
    console.log("🔎 raw(0..400):", j(body));

    // 3) Extrair mensagem de texto
    const value = body?.entry?.[0]?.changes?.[0]?.value;
    const msg = value?.messages?.[0];
    const from = msg?.from;            // ex: "554299401345"
    const text = msg?.text?.body?.trim();

    if (!from || !text) {
      console.log("ℹ️ payload sem texto ou sem from. Nada a fazer.");
      return;
    }

    console.log(`👤 numero=${from} | texto=${JSON.stringify(text)}`);

    if (!D360_API_KEY) {
      console.log("⚠️ D360_API_KEY ausente. Não consigo responder.");
      return;
    }

    // 4) Formar corpo padrão
    const payload = {
      to: from,
      recipient_type: "individual",
      type: "text",
      text: { body: `Você disse: "${text}"` } // Efeito "eco" para validação
    };

    // 5) Tenta v2, se falhar cai pra v1
    const ok = await send360(`${D360_BASE}/v2/messages`, payload, "v2")
          || await send360(`${D360_BASE}/v1/messages`, payload, "v1");

    if (ok) {
      console.log("✅ resposta enviada com sucesso.");
    } else {
      console.log("❌ Todas as tentativas falharam.");
    }
  } catch (err) {
    console.error("💥 erro no webhook:", err);
    // (já respondemos 200, então só loga)
  }
});

// Start
app.listen(PORT, () => console.log(`🚀 listening :${PORT}`));

// Graceful shutdown (Railway manda SIGTERM em cada redeploy)
process.on("SIGTERM", () => {
  console.log("🛑 SIGTERM recebido (Railway redeploy). Encerrando...");
  process.exit(0);
});

// ----- Helpers -----
async function send360(url, body, label) {
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "D360-API-KEY": D360_API_KEY
      },
      body: JSON.stringify(body)
    });

    if (r.ok) {
      console.log(`📤 ${label} OK ${r.status}`);
      return true;
    }

    // 360 costuma retornar JSON com { meta: { success, http_code, developer_message, 360dialog_trace_id } }
    let data = null;
    try { data = await r.json(); } catch {}
    console.log(`🛑 360 ${label} erro: ${r.status}`, data || await r.text());
    // se v2 deu 400/555, deixa o caller tentar v1
    if (label === "v2" && (r.status === 400 || r.status === 555)) return false;
    return false;
  } catch (e) {
    console.log(`🛑 falha de rede no ${label}:`, e?.message || e);
    return false;
  }
}

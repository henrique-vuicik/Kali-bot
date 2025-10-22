// index.js
import express from "express";

// ───────────────────────────────────────────────
// Config
// ───────────────────────────────────────────────
const app = express();
app.use(express.json());

const D360_API_KEY = process.env.D360_API_KEY?.trim();      // obrigatório
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID?.trim(); // opcional (não é usado no endpoint v2)
const PORT = process.env.PORT || 8080;

// Logger simples
const log = (lvl, msg, extra) => {
  const tag = lvl === "err" ? "🟥"
            : lvl === "ok"  ? "✅"
            : lvl === "warn"? "🟧"
            : "🟦";
  console.log(`${tag} ${msg}`, extra ? JSON.stringify(extra) : "");
};

// Verificação básica ao subir
if (!D360_API_KEY) {
  console.warn("🟧 D360_API_KEY ausente. Defina a variável de ambiente no Railway.");
}
if (!PHONE_NUMBER_ID) {
  console.warn("🟧 PHONE_NUMBER_ID ausente (ok para v2, não é usado na URL).");
}

// ───────────────────────────────────────────────
// Rotas utilitárias
// ───────────────────────────────────────────────
app.get("/", (_req, res) => {
  res.status(200).send("Kali-bot online ✅");
});

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true, ts: new Date().toISOString() });
});

// ───────────────────────────────────────────────
// Webhook de mensagens do 360dialog
// ───────────────────────────────────────────────
app.post("/webhook", async (req, res) => {
  try {
    log("info", "Webhook recebido");

    // Mensagem de texto (Cloud API / 360dialog body padrão)
    const message = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    const from = message?.from?.toString();
    const text = message?.text?.body;

    if (!from || !text) {
      log("err", "Sem número ou texto", { from, text, raw: req.body });
      return res.sendStatus(200);
    }

    log("ok", `Mensagem recebida de ${from}: ${text}`);

    // Validação simples do número BR (ajuste se precisar aceitar outros)
    if (!/^\d{10,16}$/.test(from)) {
      log("err", "Número inválido", { from });
      return res.sendStatus(200);
    }

    // ── URL CORRETA do 360dialog v2 (sem PHONE_NUMBER_ID na rota!)
    const url = "https://waba-v2.360dialog.io/v1/messages";

    // Payload mínimo válido
    const payload = {
      messaging_product: "whatsapp",
      to: from,
      type: "text",
      text: {
        body: "🟢 FUNCIONANDO! Assistente de dieta está ativo. Como posso ajudar com sua alimentação?"
      }
    };

    // Headers obrigatórios
    const headers = {
      "Content-Type": "application/json",
      "D360-API-KEY": D360_API_KEY
    };

    // Envia resposta
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    });

    const bodyText = await response.text();

    if (!response.ok) {
      log("err", `Erro ${response.status}`, { status: response.status, body: bodyText.slice(0, 300) });
    } else {
      log("ok", "✔️ RESPOSTA ENVIADA COM SUCESSO!", { numero: from, apiStatus: response.status });
    }

    // Sempre 200 pro 360dialog não reenfileirar
    res.sendStatus(200);
  } catch (error) {
    log("err", "Falha no webhook", {
      message: error?.message,
      stack: error?.stack?.split("\n")[1]?.trim()
    });
    // Ainda responde 200 para evitar retries infinitos
    res.sendStatus(200);
  }
});

// ───────────────────────────────────────────────
// Start
// ───────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  console.log(`🔔 Aguardando mensagens...`);
});
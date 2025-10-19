import express from "express";

const app = express();
app.use(express.json({ limit: "1mb" }));

// ==================== CONFIGURAÇÕES ====================
const D360_API_KEY = process.env.D360_API_KEY?.trim();
const PORT = process.env.PORT || 8080;

if (!D360_API_KEY) {
  console.error("❗ ERRO: D360_API_KEY não configurada no ambiente!");
}

// Função simples de log
const log = (lvl, msg, extra) => {
  const tag =
    lvl === "err" ? "🟥" : lvl === "ok" ? "✅" : lvl === "warn" ? "🟧" : "🟦";
  console.log(`${tag} ${msg}`, extra ? JSON.stringify(extra) : "");
};

// ==================== ROTA DE TESTE ====================
app.get("/", (_, res) => {
  res.json({
    status: "ativo",
    version: "2.0",
    config_ok: !!D360_API_KEY,
    docs: "https://docs.360dialog.com/whatsapp-api",
  });
});

// ==================== FUNÇÃO DE ENVIO VIA 360DIALOG ====================
async function sendTextVia360(from) {
  const HEADERS = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "D360-API-KEY": D360_API_KEY,
  };

  // 1️⃣ Valida o número e obtém o wa_id correto
  const verify = await fetch("https://waba-v2.360dialog.io/v1/contacts", {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({
      blocking: "wait",
      contacts: [from],
      force_check: true,
    }),
  });

  const vJson = await verify.json();
  const waId = vJson?.contacts?.[0]?.wa_id;
  const status = vJson?.contacts?.[0]?.status;

  if (status !== "valid" || !waId) {
    log("err", "Número inválido ou não encontrado no WhatsApp", vJson);
    return;
  }

  // 2️⃣ Tenta envio em dois formatos (puro e com messaging_product)
  const domains = [
    "https://waba-v2.360dialog.io/v1/messages",
    "https://waba.360dialog.io/v1/messages",
  ];

  const payloads = [
    { to: waId, type: "text", text: { body: "🟢 Assistente ativo! Como posso ajudar?" } },
    { to: waId, type: "text", messaging_product: "whatsapp", text: { body: "🟢 Assistente ativo! Como posso ajudar?" } },
  ];

  for (const url of domains) {
    for (const payload of payloads) {
      try {
        const resp = await fetch(url, {
          method: "POST",
          headers: HEADERS,
          body: JSON.stringify(payload),
        });
        const body = await resp.text();

        if (resp.ok) {
          log("ok", "✅ Mensagem enviada com sucesso!", {
            url,
            status: resp.status,
            response: body.slice(0, 200),
          });
          return;
        } else {
          log("warn", `Falhou (${resp.status})`, {
            url,
            statusText: resp.statusText,
            body: body.slice(0, 500),
          });
        }
      } catch (err) {
        log("err", "Erro no envio", { msg: err.message });
      }
    }
  }
  log("err", "❌ Todas as tentativas de envio falharam!");
}

// ==================== WEBHOOK PRINCIPAL ====================
app.post("/webhook", async (req, res) => {
  try {
    const entry = req.body?.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const message = value?.messages?.[0];

    // ignora eventos que não são mensagens
    if (!message || message.type !== "text" || !message.text?.body) {
      log("warn", "Evento ignorado (sem texto ou sem mensagem)");
      return res.sendStatus(200);
    }

    const from = message.from?.trim();
    const text = message.text.body?.trim();
    log("ok", `Recebido de ${from}: ${text}`);

    await sendTextVia360(from);

    res.sendStatus(200);
  } catch (error) {
    log("err", "Erro no webhook", {
      message: error.message,
      stack: error.stack?.split("\n")[1]?.trim(),
    });
    res.sendStatus(200);
  }
});

// ==================== INÍCIO DO SERVIDOR ====================
app.listen(PORT, () => {
  console.log(`🚀 SERVIDOR INICIADO NA PORTA ${PORT}`);
  console.log(`🔔 Pronto para receber mensagens do WhatsApp via 360dialog...`);
});
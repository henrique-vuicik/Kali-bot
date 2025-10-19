import express from "express";

const app = express();
app.use(express.json({ limit: "1mb" }));

// CONFIGURAÇÕES
const D360_API_KEY = process.env.D360_API_KEY?.trim();
const PORT = process.env.PORT || 8080;

// Validação de configuração
if (!D360_API_KEY) {
  console.error("❗ ERRO: D360_API_KEY não configurada");
}

const log = (lvl, msg, extra) => {
  const tag = lvl === "err" ? "🟥" : lvl === "ok" ? "✅" : "🟦";
  console.log(`${tag} ${msg}`, extra ? JSON.stringify(extra) : "");
};

// Rota de teste / health
app.get("/", (_, res) => {
  res.json({
    status: "ativo",
    config_ok: !!D360_API_KEY,
    version: "1.2",
  });
});

// Webhook principal (360dialog)
app.post("/webhook", async (req, res) => {
  try {
    log("ok", "Webhook recebido", { count: req.body?.entry?.length });

    // Extração segura
    const entry = req.body?.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const message = value?.messages?.[0];

    if (!entry || !changes || !value || !message) {
      log("err", "Payload sem message", { body_keys: Object.keys(req.body || {}) });
      return res.sendStatus(200);
    }

    // Status webhooks (ack, delivered, read) — ignore
    if (value?.statuses?.length) {
      log("ok", "Evento de status ignorado", { kind: "status" });
      return res.sendStatus(200);
    }

    // Só processa mensagem de texto
    if (message.type !== "text" || !message.text?.body) {
      log("ok", "Mensagem não-texto ignorada", { type: message.type });
      return res.sendStatus(200);
    }

    const from = String(message.from || "").trim(); // wa_id do remetente
    const text = String(message.text.body || "").trim();

    if (!from || !text) {
      log("err", "Faltando from/text", { from, text });
      return res.sendStatus(200);
    }

    // (Opcional) Validação simples do formato do WA ID
    if (!/^\d{8,16}$/.test(from)) {
      log("err", "WA ID inválido", { from });
      return res.sendStatus(200);
    }

    log("ok", `Recebido de ${from}: ${text}`);

    // === ENVIO VIA 360dialog (schema correto) ===
    const url = "https://waba-v2.360dialog.io/v1/messages";
    const payload = {
      to: from,
      type: "text",
      text: {
        body: "🟢 FUNCIONANDO! Assistente de dieta está ativo. Como posso ajudar?"
      }
    };

    const headers = new Headers();
    headers.append("Content-Type", "application/json");
    headers.append("D360-API-KEY", D360_API_KEY);

    log("ok", "Enviando resposta", {
      url,
      to: from,
      payload_len: JSON.stringify(payload).length
    });

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    });

    const raw = await response.text();
    if (!response.ok) {
      log("err", `Erro ${response.status} ${response.statusText}`, {
        status: response.status,
        body: raw.slice(0, 500)
      });
    } else {
      log("ok", "Resposta enviada com sucesso", { status: response.status });
    }

    return res.sendStatus(200);
  } catch (error) {
    log("err", "Erro no webhook", {
      message: error.message,
      name: error.name,
      stack: error.stack?.split("\n")[1]?.trim()
    });
    return res.sendStatus(200);
  }
});

// Inicia o servidor
app.listen(PORT, () => {
  console.log(`🚀 SERVIDOR INICIADO NA PORTA ${PORT}`);
  console.log(`🔔 Pronto para receber mensagens...`);
});

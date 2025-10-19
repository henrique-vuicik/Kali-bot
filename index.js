import express from "express";

const app = express();
app.use(express.json());

// CONFIGURAÇÕES - VERIFIQUE TODAS
const D360_API_KEY = process.env.D360_API_KEY;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const PORT = process.env.PORT || 8080;

// Validação inicial
if (!D360_API_KEY) {
  console.error("❗ ERRO: D360_API_KEY não configurada");
}
if (!PHONE_NUMBER_ID) {
  console.error("❗ ERRO: PHONE_NUMBER_ID não configurada");
}

const log = (lvl, msg, extra) => {
  const tag = lvl === "err" ? "🟥" : lvl === "ok" ? "✅" : "🟦";
  console.log(`${tag} ${msg}`, extra ? JSON.stringify(extra, null, 2) : "");
};

// Rota de saúde
app.get("/", (_, res) => {
  res.json({ 
    status: "ativo",
    configuracao_ok: !!(D360_API_KEY && PHONE_NUMBER_ID)
  });
});

// Webhook principal
app.post("/webhook", async (req, res) => {
  try {
    log("🟦", "Webhook recebido", { headers: req.headers });

    // EXTRAÇÃO SEGURA DA MENSAGEM
    const entry = req.body?.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const messages = value?.messages?.[0];
    
    // Verificação completa
    if (!value || !messages || !messages.text) {
      log("ok", "Webhook sem mensagem de texto", { value, messages });
      return res.sendStatus(200);
    }

    const from = messages.from;
    const text = messages.text.body;
    
    if (!from || !text) {
      log("ok", "Faltando número ou texto", { from, text });
      return res.sendStatus(200);
    }

    log("✅", `Mensagem de ${from}: ${text}`);

    // PAYLOAD CORRETO - NÃO MODIFIQUE
    const payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: from.toString(),  // Garante string
      type: "text",
      text: { 
        body: "🎉 FUNCIONANDO! Assistente de dieta está ativo. Como posso ajudar com sua alimentação?" 
      }
    };

    // HEADERS CORRETOS
    const headers = {
      "Content-Type": "application/json",
      "D360-API-KEY": D360_API_KEY
    };

    // URL CORRETA
    const url = `https://waba-v2.360dialog.io/v1/${PHONE_NUMBER_ID}/messages`;

    log("➤", "Enviando resposta", { 
      url: url.replace(PHONE_NUMBER_ID, "REDACTED"),
      payload: { ...payload, to: "REDACTED" } 
    });

    // TENTATIVA DE ENVIO
    const r = await fetch(url, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(payload)
    });

    const responseData = await r.text();
    
    if (!r.ok) {
      log("❌", `Erro ${r.status} ${r.statusText}`, { 
        status: r.status,
        responseData: responseData.substring(0, 200) 
      });
    } else {
      log("✅", "MENSAGEM ENVIADA COM SUCESSO!", { 
        status: r.status 
      });
    }

    // Sempre responde 200 para o webhook
    res.sendStatus(200);

  } catch (error) {
    log("💥", "Erro crítico", {
      message: error.message,
      stack: error.stack?.split('\n').slice(0, 3)
    });
    res.sendStatus(200);
  }
});

// Inicia o servidor
const server = app.listen(PORT, () => {
  console.log(`🚀 SERVIDOR INICIADO NA PORTA ${PORT}`);
  console.log(`🔔 Logs serão exibidos abaixo...`);
});

// Proteção contra erros não tratados
process.on('uncaughtException', (error) => {
  console.log(`⛔ ERRO NÃO TRATADO:`, error);
});

import express from "express";

const app = express();
app.use(express.json());

// Configurações principais
const D360_API_KEY = process.env.D360_API_KEY || "";
const BASE_URL = "https://waba.360dialog.io";
const PORT = process.env.PORT || 8080;

// Validação de configuração
if (!D360_API_KEY) {
  console.error("Erro: D360_API_KEY não configurada nas variáveis de ambiente");
}

const log = (lvl, msg, extra) => {
  const tag = lvl === "err" ? "🟥" : lvl === "ok" ? "✅" : "🟦";
  console.log(`${tag} ${msg}`, extra ? JSON.stringify(extra, null, 2) : "");
};

// Rota de teste
app.get("/", (req, res) => {
  res.json({
    status: "ativo",
    api_key_configurada: !!D360_API_KEY,
    versao: "1.0.0",
    mensagem: "Assistente de Dieta pronto"
  });
});

// Webhook principal
app.post("/webhook", async (req, res) => {
  try {
    log("🟦", "Webhook recebido", { body: req.body });

    // Verifique a estrutura do webhook
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];
    
    // Verifique se é mensagem de texto
    if (!message || !message.text) {
      log("ok", "Webhook sem mensagem de texto ou não é texto", { message });
      return res.sendStatus(200);
    }

    const from = message.from;
    const text = message.text.body;
    
    if (!from || !text) {
      log("ok", "Sem número ou texto na mensagem", { from, text });
      return res.sendStatus(200);
    }

    log("ok", `Mensagem recebida de ${from}: ${text}`);

    // Verifique se é mensagem de outro bot (para evitar loop)
    if (message.type === "text" && text.toLowerCase().includes("eco")) {
      log("ok", "Mensagem de eco ignorada para evitar loop");
      return res.sendStatus(200);
    }

    // Payload de resposta
    const payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: from,
      type: "text",
      text: { 
        body: "✅ Mensagem recebida com sucesso! Este é seu assistente de dieta. Como posso ajudar com sua alimentação hoje?" 
      }
    };

    // Cabeçalhos de autenticação CORRETOS para 360dialog
    const headers = {
      "Content-Type": "application/json",
      "D360-API-KEY": D360_API_KEY  // ❌ NÃO use "Bearer" - ESTA É A CORREÇÃO PRINCIPAL
    };

    log("🟦", "Enviando resposta", { url: `${BASE_URL}/messages`, payload });

    // Envia a mensagem
    const response = await fetch(`${BASE_URL}/messages`, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(payload)
    });

    // Leia a resposta como texto primeiro
    const responseData = await response.text();
    
    if (!response.ok) {
      log("err", `Erro ${response.status} - ${response.statusText}`, { 
        responseData, 
        status: response.status 
      });
    } else {
      log("ok", "Mensagem enviada com sucesso!", { responseData });
    }

    // Responde ao webhook com sucesso
    res.sendStatus(200);

  } catch (error) {
    log("err", "Erro no webhook", {
      message: error.message,
      stack: error.stack
    });
    res.sendStatus(200);
  }
});

// Inicia o servidor
app.listen(PORT, () => {
  console.log(`🚀 Assistente de Dieta iniciado na porta ${PORT}`);
  console.log(`🔗 URL: http://localhost:${PORT}`);
  console.log(`📊 Verifique / para status`);
});

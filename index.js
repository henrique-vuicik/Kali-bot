import express from "express";

const app = express();
app.use(express.json());

// Configurações
const D360_API_KEY = process.env.D360_API_KEY?.trim();
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID?.trim();
const PORT = process.env.PORT || 8080;

const log = (lvl, msg, extra) => {
  const tag = lvl === "err" ? "🟥" : lvl === "ok" ? "✅" : "🟦";
  console.log(`${tag} ${msg}`, extra ? JSON.stringify(extra) : "");
};

app.post("/webhook", async (req, res) => {
  try {
    log("🟦", "Webhook recebido");

    // Extração da mensagem
    const message = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    const from = message?.from?.toString();
    const text = message?.text?.body;
    
    if (!from || !text) {
      log("err", "Sem número ou texto", { from, text });
      return res.sendStatus(200);
    }

    // Log do número real
    log("✅", `Mensagem recebida do número: ${from}`, { texto: text });

    // Validação básica do número
    if (!from.startsWith("55") || from.length < 10) {
      log("err", "Número inválido", { from });
      return res.sendStatus(200);
    }

    // URL de envio
    const url = `https://waba-v2.360dialog.io/v1/${PHONE_NUMBER_ID}/messages`;

    // Payload de resposta
    const payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: from,
      type: "text",
      text: { 
        body: "🟢 FUNCIONANDO! Assistente de dieta está ativo e funcionando. Como posso ajudar com sua alimentação?" 
      }
    };

    // Headers
    const headers = {
      "Content-Type": "application/json",
      "D360-API-KEY": D360_API_KEY
    };

    // Envio da resposta
    const response = await fetch(url, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(payload)
    });

    const body = await response.text();

    if (!response.ok) {
      log("❌", `Erro ${response.status}`, { 
        status: response.status,
        body: body.substring(0, 200)
      });
    } else {
      log("✅", "✔️ RESPOSTA ENVIADA COM SUCESSO PARA O NÚMERO!", { 
        numero: from 
      });
    }

    res.sendStatus(200);

  } catch (error) {
    log("💥", "Erro no webhook", { 
      message: error.message,
      stack: error.stack?.split('\n')[1]?.trim()
    });
    res.sendStatus(200);
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  console.log(`🔔 Aguardando mensagens de QUALQUER número válido...`);
});

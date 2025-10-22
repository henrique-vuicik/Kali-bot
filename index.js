import express from "express";

const app = express();
app.use(express.json());

// 🔧 Configurações
const D360_API_KEY = process.env.D360_API_KEY?.trim();
const PORT = process.env.PORT || 8080;

const log = (lvl, msg, extra) => {
  const tag =
    lvl === "err" ? "🟥" : lvl === "ok" ? "✅" : lvl === "💥" ? "💥" : "🟦";
  console.log(`${tag} ${msg}`, extra ? JSON.stringify(extra) : "");
};

app.post("/webhook", async (req, res) => {
  try {
    log("🟦", "Webhook recebido");

    // 📥 Extração da mensagem recebida
    const message = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    const from = message?.from?.toString();
    const text = message?.text?.body;

    if (!from || !text) {
      log("err", "Sem número ou texto", { from, text });
      return res.sendStatus(200);
    }

    // 📞 Log do número real
    log("ok", `Mensagem recebida do número: ${from}`, { texto: text });

    // 🔍 Validação básica do número (Brasil)
    if (!from.startsWith("55") || from.length < 10) {
      log("err", "Número inválido", { from });
      return res.sendStatus(200);
    }

    // 🌐 URL correta da 360dialog (sem PHONE_NUMBER_ID)
    const url = "https://waba-v2.360dialog.io/v1/messages";

    // 💬 Payload compatível com a 360dialog Cloud API
    const payload = {
      to: from,
      type: "text",
      text: {
        body:
          "🟢 FUNCIONANDO! Assistente de dieta ativo. Como posso ajudar?"
      },
    };

    // 🧾 Cabeçalhos da requisição
    const headers = {
      "Content-Type": "application/json",
      "D360-API-KEY": D360_API_KEY,
    };

    // 🚀 Envio da resposta via API 360dialog
    const response = await fetch(url, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(payload),
    });

    const body = await response.text();

    if (!response.ok) {
      log("err", `Erro ${response.status}`, {
        status: response.status,
        body: body.substring(0, 200),
      });
    } else {
      log("ok", "✔️ RESPOSTA ENVIADA COM SUCESSO!", { numero: from });
    }

    res.sendStatus(200);
  } catch (error) {
    log("💥", "Erro no webhook", {
      message: error.message,
      stack: error.stack?.split("\n")[1]?.trim(),
    });
    res.sendStatus(200);
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  console.log(`🔔 Aguardando mensagens de QUALQUER número válido...`);
});
// server.js
import express from "express";

const app = express();
app.use(express.json());

// ====== ENV ======
const D360_API_KEY = process.env.D360_API_KEY?.trim();
const PORT = process.env.PORT || 8080;

// Sane check
if (!D360_API_KEY) {
  console.error("❌ Faltando D360_API_KEY nas variáveis de ambiente.");
  process.exit(1);
}

// ====== Utils ======
const log = (lvl, msg, extra) => {
  const tag =
    lvl === "err" ? "🟥" :
    lvl === "ok"  ? "✅" :
    lvl === "dbg" ? "🟦" : "⬜";
  const payload = extra ? ` ${JSON.stringify(extra)}` : "";
  console.log(`${tag} ${msg}${payload}`);
};

// ====== Health ======
app.get("/", (_, res) => res.status(200).send("OK"));

// ====== Webhook (360dialog → seu servidor) ======
app.post("/webhook", async (req, res) => {
  try {
    log("dbg", "Webhook recebido");

    // Estrutura típica da Cloud API/360dialog
    const change = req.body?.entry?.[0]?.changes?.[0]?.value;
    const message = change?.messages?.[0];

    // Identifica o remetente e o texto (cobre alguns tipos comuns)
    const from = message?.from?.toString();
    let text =
      message?.text?.body ??
      message?.button?.text ??
      message?.interactive?.button_reply?.title ??
      message?.interactive?.list_reply?.title ??
      message?.reaction?.emoji ??
      "";

    if (!from || !text) {
      log("err", "Sem número ou texto", { from, text, type: message?.type });
      return res.sendStatus(200);
    }

    // Normaliza número: apenas dígitos
    const to = from.replace(/\D/g, "");

    // Validação simples Brasil (ajuste se quiser aceitar outros DDI)
    if (!/^\d{10,15}$/.test(to)) {
      log("err", "Número inválido", { to });
      return res.sendStatus(200);
    }

    log("ok", "Mensagem recebida", { from: to, texto: text });

    // ====== Envio de resposta pela 360dialog (Cloud API hosted by Meta) ======
    // Endpoint correto NÃO contém phone_number_id
    const url = "https://waba-v2.360dialog.io/v1/messages";

    const payload = {
      to,
      type: "text",
      text: {
        body:
          "🟢 FUNCIONANDO! Assistente de dieta ativo.\n" +
          "Diga-me seu objetivo (ex.: emagrecer, ganhar massa, manter) e sua rotina de refeições. 😉"
      }
    };

    const headers = {
      "Content-Type": "application/json",
      "D360-API-KEY": D360_API_KEY
    };

    const resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    });

    const respBody = await resp.text();
    if (!resp.ok) {
      log("err", "Erro ao enviar via 360dialog", {
        status: resp.status,
        body: respBody.slice(0, 500)
      });
    } else {
      log("ok", "Resposta enviada com sucesso", {
        status: resp.status,
        body: respBody.slice(0, 500)
      });
    }

    // Sempre responde 200 ao webhook da 360
    res.sendStatus(200);
  } catch (error) {
    log("err", "Exceção no webhook", {
      message: error?.message,
      stack: error?.stack?.split("\n")[1]?.trim()
    });
    res.sendStatus(200);
  }
});

// ====== Start ======
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  console.log("🔔 Aguardando mensagens de QUALQUER número válido...");
  console.log("➡️  Certifique-se que o WABA Webhook do 360dialog aponta para /webhook");
});
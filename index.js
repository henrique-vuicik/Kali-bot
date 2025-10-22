import express from "express";

const app = express();
app.use(express.json());

// 🔧 Variáveis de ambiente (Railway → Variables)
const D360_API_KEY = process.env.D360_API_KEY?.trim();
const PORT = process.env.PORT || 8080;

// 🔎 logger simples
const log = (lvl, msg, extra) => {
  const tag = lvl === "err" ? "🟥" : lvl === "ok" ? "✅" : "🟦";
  console.log(`${tag} ${msg}`, extra ? JSON.stringify(extra) : "");
};

// 🔔 Webhook de mensagens
app.post("/webhook", async (req, res) => {
  try {
    log("🟦", "Webhook recebido");

    // 📥 Extrai a primeira mensagem do evento
    const message = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    const from = message?.from?.toString();
    const text = message?.text?.body;

    if (!from || !text) {
      log("err", "Sem número ou texto", { from, text });
      return res.sendStatus(200);
    }

    log("✅", "Mensagem recebida", { from, text });

    // Validação leve do número (formato wa: só dígitos com DDI)
    if (!/^\d{10,16}$/.test(from)) {
      log("err", "Número inválido para envio", { from });
      return res.sendStatus(200);
    }

    // 🌐 Endpoint correto da 360dialog (Cloud API)
    // Se o teu “Hosting Platform Type” no 360D diz “Cloud API hosted by Meta”, usa este domínio:
    const url = "https://waba-v2.360dialog.io/v1/messages";

    // 💬 Payload EXATO exigido pela Cloud API (inclui messaging_product)
    const payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: from,
      type: "text",
      text: {
        preview_url: false,
        body: "🟢 FUNCIONANDO! Assistente de dieta ativo. Como posso ajudar?"
      }
    };

    // 🧾 Headers exigidos pela 360dialog
    const headers = {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "D360-API-KEY": D360_API_KEY
    };

    // 🚀 Envia a resposta
    const resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    });

    const respText = await resp.text();
    if (!resp.ok) {
      log("err", `Erro ${resp.status}`, { body: respText?.slice(0, 500) });
    } else {
      log("✅", "Resposta enviada com sucesso", { numero: from, resp: respText });
    }

    res.sendStatus(200);
  } catch (e) {
    log("err", "Falha no webhook", { message: e.message });
    res.sendStatus(200);
  }
});

// ♻️ Endpoint simples pra teste (“healthcheck”)
app.get("/", (_req, res) => res.send("OK"));

app.listen(PORT, () => {
  console.log(`🚀 Servidor na porta ${PORT}`);
});
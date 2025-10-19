import express from "express";

const app = express();
app.use(express.json());

const D360_API_KEY = process.env.D360_API_KEY;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const PORT = process.env.PORT || 8080;

const log = (lvl, msg, extra) => {
  const tag = lvl === "err" ? "🟥" : lvl === "ok" ? "✅" : "🟦";
  console.log(`${tag} ${msg}`, extra ? JSON.stringify(extra) : "");
};

app.get("/", (_, res) => {
  res.json({ status: "ativo" });
});

app.post("/webhook", async (req, res) => {
  try {
    // Extração correta da mensagem
    const message = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    const from = message?.from;
    const text = message?.text?.body;
    
    if (!from || !text || !message) {
      return res.sendStatus(200);
    }

    log("ok", `Recebido de ${from}: ${text}`);

    // Payload corrigido com recipient_type
    const payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",  // ✅ Campo obrigatório adicionado
      to: from,
      type: "text",
      text: { 
        body: "✅ Funcionando! Este é seu assistente de dieta." 
      }
    };

    const headers = {
      "Content-Type": "application/json",
      "D360-API-KEY": D360_API_KEY
    };

    const url = `https://waba-v2.360dialog.io/v1/${PHONE_NUMBER_ID}/messages`;

    log("🟦", "Enviando", { url, payload });

    const r = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    });

    const data = await r.text();
    
    if (!r.ok) {
      log("err", `Erro ${r.status}`, { data });
    } else {
      log("ok", "Resposta enviada com sucesso!");
    }

    res.sendStatus(200);

  } catch (e) {
    log("err", "Erro no webhook", { message: e.message });
    res.sendStatus(200);
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Rodando na porta ${PORT}`);
});

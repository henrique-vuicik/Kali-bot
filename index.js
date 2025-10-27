import express from "express";

const app = express();
app.use(express.json());

// 🔧 Variáveis de ambiente
const API_URL = process.env.WHATSAPP_API_URL || "https://waba-v2.360dialog.io/v1/messages";
const D360 = process.env.D360_API_KEY;

// 🩺 Healthcheck
app.get("/", (req, res) => res.send("Kali ok"));
app.get("/ping", (req, res) => res.send("pong"));

// 📩 Webhook do WhatsApp
app.post("/webhook", async (req, res) => {
  console.log("🟦 Webhook recebido");
  console.log("↩️ body:", JSON.stringify(req.body));

  const value = req.body?.entry?.[0]?.changes?.[0]?.value;
  const to = value?.contacts?.[0]?.wa_id;
  const body = value?.messages?.[0]?.text?.body || "Olá!";

  if (to && D360) {
    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "D360-API-KEY": D360
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to,
          type: "text",
          text: { body: `Você disse: ${body}` }
        })
      });

      const json = await response.json().catch(() => ({}));
      console.log("➡️ 360 status:", response.status, "body:", json);
    } catch (error) {
      console.log("🔥 Falha ao enviar via 360:", error.message);
    }
  } else {
    console.log("⚠️ Nenhum destinatário válido ou token ausente.");
  }

  res.sendStatus(200);
});

// 🚀 Inicialização
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🚀 Kali Nutro IA estável rodando na porta ${PORT}`);
  console.log(`🔔 Endpoint 360: ${API_URL}`);
});
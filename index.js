import express from "express";
import axios from "axios";

const app = express();
app.use(express.json());

// ✅ Healthcheck (Railway não mata o container)
app.get("/", (_req, res) => {
  res.status(200).send("ok");
});

app.post("/webhook", async (req, res) => {
  try {
    const body = req.body;
    console.log("📥 POST /webhook | flags msgs:%s contacts:%s statuses:%s",
      !!body.entry?.[0]?.changes?.[0]?.value?.messages,
      !!body.entry?.[0]?.changes?.[0]?.value?.contacts,
      !!body.entry?.[0]?.changes?.[0]?.value?.statuses
    );

    const change = body.entry?.[0]?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];
    const contact = value?.contacts?.[0];

    if (!message || !contact) {
      res.sendStatus(200);
      return;
    }

    const texto = message.text?.body?.trim();
    const numero = contact.wa_id;

    console.log(`👤 numero=${numero} | texto="${texto}"`);

    // texto de resposta simples
    const resposta = `Olá, ${contact.profile?.name || ""}! 👋
Recebi sua mensagem: "${texto}"`;

    // --- 1️⃣ Envio pela 360dialog
    const d360ApiKey = process.env.D360_API_KEY;
    let enviado = false;

    if (d360ApiKey) {
      try {
        const payload = {
          to: numero,
          type: "text",
          text: { body: resposta },
        };

        // nova API v2
        await axios.post("https://waba.360dialog.io/v2/messages", payload, {
          headers: {
            "D360-API-KEY": d360ApiKey,
            "Content-Type": "application/json",
          },
        });

        enviado = true;
        console.log("✅ Enviado pela 360 v2");
      } catch (err) {
        const code = err.response?.status || "??";
        console.log(`🛑 360 v2 erro: ${code}`, err.response?.data || err.message);

        // tenta fallback v1
        try {
          await axios.post("https://waba.360dialog.io/v1/messages", {
            to: numero,
            type: "text",
            text: { body: resposta },
          }, {
            headers: {
              "D360-API-KEY": d360ApiKey,
              "Content-Type": "application/json",
            },
          });

          enviado = true;
          console.log("✅ Enviado pela 360 v1");
        } catch (err2) {
          console.log("🛑 360 v1 erro:", err2.response?.status, err2.response?.data || err2.message);
        }
      }
    }

    // --- 2️⃣ Fallback via Cloud API da Meta
    if (!enviado) {
      const token = process.env.WHATSAPP_TOKEN;
      const phoneId = process.env.CLOUD_PHONE_NUMBER_ID || value?.metadata?.phone_number_id;

      if (token && phoneId) {
        try {
          await axios.post(
            `https://graph.facebook.com/v20.0/${phoneId}/messages`,
            {
              messaging_product: "whatsapp",
              to: numero,
              type: "text",
              text: { body: resposta },
            },
            {
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
              },
            }
          );

          enviado = true;
          console.log("✅ Enviado via Cloud API");
        } catch (err3) {
          console.log("🛑 Cloud API erro:", err3.response?.status, err3.response?.data || err3.message);
        }
      } else {
        console.log("ℹ️ Cloud API fallback indisponível (sem WHATSAPP_TOKEN/phoneNumberId).");
      }
    }

    if (!enviado) console.log("❌ Todas as tentativas falharam.");
    res.sendStatus(200);

  } catch (err) {
    console.error("❌ Erro no webhook:", err);
    res.sendStatus(500);
  }
});

// ✅ Handlers de encerramento para debug
process.on("SIGTERM", () => {
  console.log("🛑 SIGTERM recebido (Railway redeploy). Encerrando...");
  process.exit(0);
});
process.on("SIGINT", () => {
  console.log("🛑 SIGINT (interrompido manualmente).");
  process.exit(0);
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => console.log(`🚀 listening :${PORT}`));

// index.js — ultra simples, só 360
import express from "express";

const app = express();
app.use(express.json());

// variáveis de ambiente necessárias
const {
  D360_API_KEY = "",
  D360_BASE = "https://waba-v2.360dialog.io", // v2 da 360
  D360_FROM = "", // seu número remetente no formato E.164 sem +, ex: 554291251751
  PORT = 8080
} = process.env;

app.get("/", (_, res) => res.status(200).send("ok"));

app.post("/webhook", async (req, res) => {
  // sempre responda 200 rápido ao 360
  res.sendStatus(200);

  try {
    // tente extrair texto e número do payload (Cloud/Meta ou 360)
    const body = req.body || {};
    let texto = "";
    let to = "";

    // Cloud API formato (o que aparece nos seus logs)
    if (body.object === "whatsapp_business_account") {
      const change = body.entry?.[0]?.changes?.[0]?.value;
      texto = change?.messages?.[0]?.text?.body || "";
      to = change?.messages?.[0]?.from || "";
    }

    // 360 mock/test também pode mandar em body.messages[0]
    if (!texto && body?.messages?.[0]?.text?.body) {
      texto = body.messages[0].text.body;
      to = body.messages[0].from || "";
    }

    if (!texto || !to) {
      console.log("ℹ️ payload sem texto ou sem from. Nada a fazer.");
      return;
    }

    console.log(`📥 msg de ${to}: "${texto}"`);

    // resposta eco via 360 (sessão)
    const resp = await fetch(`${D360_BASE}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "D360-API-KEY": D360_API_KEY.trim()
      },
      body: JSON.stringify({
        // incluir 'from' ajuda em alguns canais multi-tenant da 360
        from: D360_FROM || undefined,
        to,
        type: "text",
        text: { body: `Você disse: ${texto}` }
      })
    });

    const out = await resp.text();
    if (!resp.ok) {
      console.log("🛑 360 respondeu erro:", resp.status, out);
    } else {
      console.log("✅ 360 OK:", out.slice(0, 300));
    }
  } catch (e) {
    console.error("❌ Erro ao processar:", e);
  }
});

// encerrar limpo no Railway
process.on("SIGTERM", () => {
  console.log("🛑 SIGTERM — encerrando...");
  process.exit(0);
});

app.listen(PORT, () => console.log(`🚀 listening :${PORT}`));

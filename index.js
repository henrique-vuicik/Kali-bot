import express from "express";

const app = express();
app.use(express.json());

const {
  API_KEY,
  BASE_URL = "https://waba-v2.360dialog.io",
  PHONE_NUMBER_ID,
  FROM_NUMBER,
  PORT = 8080,
} = process.env;

app.get("/", (_req, res) => res.send("ok"));
app.get("/health", (_req, res) => res.json({ ok: true }));
// temporário p/ conferir envs em produção (não imprime valores sensíveis)
app.get("/vars", (_req, res) => {
  res.json({
    has_API_KEY: !!API_KEY,
    BASE_URL,
    PHONE_NUMBER_ID,
    FROM_NUMBER,
    PORT
  });
});

app.post("/webhook", async (req, res) => {
  try {
    let from, text;

    // Formato Cloud API (entry -> changes)
    if (req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]) {
      const msg = req.body.entry[0].changes[0].value.messages[0];
      from = msg.from;
      text =
        msg.text?.body ||
        msg.button?.text ||
        msg.interactive?.text?.body ||
        msg.interactive?.list_reply?.title ||
        msg.interactive?.button_reply?.title;
    }

    // Formato “teste” da 360
    if (!from && req.body?.messages?.[0]) {
      const msg = req.body.messages[0];
      from = msg.from || req.body.contacts?.[0]?.wa_id;
      text = msg.text?.body;
    }

    if (!from || !text) {
      console.log("ℹ️ payload sem texto ou from. Ignorando.");
      return res.sendStatus(200);
    }

    console.log(`💬 msg de ${from}: "${text}"`);

    if (!API_KEY || !PHONE_NUMBER_ID) {
      console.error("🛑 Falta API_KEY ou PHONE_NUMBER_ID");
      return res.sendStatus(200);
    }

    const url = `${BASE_URL}/v1/${PHONE_NUMBER_ID}/messages`;

    const payload = {
      messaging_product: "whatsapp",
      to: from,
      type: "text",
      text: { body: `Echo: ${text}` },
    };

    const r = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await r.text();
    if (!r.ok) {
      console.error("🛑 360 erro:", r.status, data);
    } else {
      console.log("✅ 360 ok:", data);
    }

    res.sendStatus(200);
  } catch (e) {
    console.error("❌ Erro ao processar:", e);
    res.sendStatus(200);
  }
});

app.listen(PORT, () => {
  console.log(`🚀 listening :${PORT}`);
});

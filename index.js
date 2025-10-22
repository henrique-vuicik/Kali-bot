import express from "express";

const app = express();
app.use(express.json());

// ========= ENV =========
const D360_API_KEY = process.env.D360_API_KEY?.trim(); // obrigatório
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID?.trim(); // ex.: 884962384692953 (WABA Channel External ID)
const PORT = process.env.PORT || 8080;

const log = (lvl, msg, extra) => {
  const tag = lvl === "err" ? "🟥" : lvl === "ok" ? "✅" : "🟦";
  console.log(`${tag} ${msg}${extra ? " " + JSON.stringify(extra) : ""}`);
};

if (!D360_API_KEY) {
  console.error("🟥 Falta D360_API_KEY no ambiente do Railway.");
}

// ========= HELPERS =========
async function trySend(url, payload, headers, label) {
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (res.ok) {
    log("ok", `Enviado (${label})`, { status: res.status, body: text.slice(0, 300) });
    return true;
  } else {
    log("err", `Falhou (${label})`, { status: res.status, body: text.slice(0, 300) });
    return false;
  }
}

// tenta todas as variações conhecidas da 360 (Cloud/Legacy)
async function sendText360({ to, from, body }) {
  const base = "https://waba-v2.360dialog.io/v1";
  const headers = {
    "Content-Type": "application/json",
    "D360-API-KEY": D360_API_KEY,
  };

  // V1) /v1/messages com messaging_product (Cloud-style)
  const p1 = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body },
  };
  if (await trySend(`${base}/messages`, p1, headers, "v1/messages + messaging_product")) return true;

  // V2) /v1/messages sem messaging_product (legacy)
  const p2 = { to, type: "text", text: { body } };
  if (await trySend(`${base}/messages`, p2, headers, "v1/messages (legacy)")) return true;

  // V3) /v1/messages com from explícito
  const p3 = { from, to, type: "text", text: { body } };
  if (await trySend(`${base}/messages`, p3, headers, "v1/messages + from")) return true;

  // V4) /v1/{PHONE_ID}/messages (alguns ambientes exigem path com ID)
  if (PHONE_NUMBER_ID) {
    const p4 = { to, type: "text", text: { body } };
    if (await trySend(`${base}/${encodeURIComponent(PHONE_NUMBER_ID)}/messages`, p4, headers, "v1/{PHONE_ID}/messages (legacy)")) return true;

    // V5) /v1/{PHONE_ID}/messages + from
    const p5 = { from, to, type: "text", text: { body } };
    if (await trySend(`${base}/${encodeURIComponent(PHONE_NUMBER_ID)}/messages`, p5, headers, "v1/{PHONE_ID}/messages + from")) return true;
  } else {
    log("err", "PHONE_NUMBER_ID ausente — algumas variações não serão testadas.");
  }

  return false;
}

// ========= ROUTES =========
app.get("/", (_req, res) => res.status(200).send("OK"));

app.post("/webhook", async (req, res) => {
  try {
    log("🟦", "Webhook recebido");

    const value = req.body?.entry?.[0]?.changes?.[0]?.value;
    const msg = value?.messages?.[0];
    const from = msg?.from?.toString(); // ex.: "5542999..."
    const text = msg?.text?.body
      ?? msg?.interactive?.button_reply?.title
      ?? msg?.interactive?.list_reply?.title
      ?? null;

    if (!from) {
      log("err", "Sem campo 'from' no payload");
      return res.sendStatus(200);
    }

    log("ok", "Mensagem recebida", { from, text });

    // resposta simples (sem template)
    const reply = text
      ? `🟢 FUNCIONANDO! Recebi: "${text}". Como posso ajudar?`
      : "🟢 FUNCIONANDO! Pode me mandar uma mensagem de texto.";

    // tenta enviar em variações até uma dar 200
    const ok = await sendText360({
      to: from,
      from: process.env.BUSINESS_NUMBER || "554291251751", // seu número WABA (ajuste se necessário)
      body: reply,
    });

    if (!ok) {
      log("err", "Nenhuma variação de envio foi aceita pela 360.");
    }

    // sempre 200 pro WhatsApp não re-tentar
    res.sendStatus(200);
  } catch (e) {
    log("err", "Exceção no webhook", { message: e?.message });
    res.sendStatus(200);
  }
});

// ========= START =========
app.listen(PORT, () => {
  console.log(`🚀 Servidor na porta ${PORT}`);
  console.log("🔔 Aguardando mensagens...");
});
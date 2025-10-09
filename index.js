// index.js
const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json({ limit: "2mb" }));

// Porta (Railway define PORT)
const PORT = process.env.PORT || 8080;

// Tenta várias chaves de ambiente possíveis para o token 360
function getD360Token() {
  return (
    process.env.D360_API_KEY ||
    process.env.D360_API_TOKEN ||
    process.env.D360_API ||
    process.env.DIALOG360_API_KEY ||
    process.env.DIALOG360_TOKEN
  );
}

// Extrai com segurança o "value" da mudança
function getChangeValue(body) {
  try {
    const entry = body?.entry?.[0];
    const change = entry?.changes?.[0];
    // Alguns payloads já trazem o objeto direto em "value"
    return change?.value ?? change;
  } catch {
    return undefined;
  }
}

// Extrai o número do remetente de forma resiliente
function extractSenderNumber(body) {
  const value = getChangeValue(body);
  if (!value) return null;

  // 1) Mensagens comuns
  const msg = Array.isArray(value.messages) ? value.messages[0] : undefined;
  if (msg?.from) return String(msg.from).trim();

  // 2) Contatos (quando não vem em messages)
  const contact = Array.isArray(value.contacts) ? value.contacts[0] : undefined;
  if (contact?.wa_id) return String(contact.wa_id).trim();

  // 3) Status (entregas/leitura): recipient_id
  const status = Array.isArray(value.statuses) ? value.statuses[0] : undefined;
  if (status?.recipient_id) return String(status.recipient_id).trim();

  return null;
}

// Extrai texto útil (quando houver)
function extractMessageText(body) {
  const value = getChangeValue(body);
  const msg = Array.isArray(value?.messages) ? value.messages[0] : undefined;
  if (!msg) return null;

  if (msg.text?.body) return msg.text.body;
  if (msg.button?.text) return msg.button.text;

  // Interactives
  const i = msg.interactive;
  if (i?.button_reply?.title) return i.button_reply.title;
  if (i?.list_reply?.title) return i.list_reply.title;

  return null;
}

// Envia uma resposta simples via 360dialog (opcional)
async function replyVia360(to, text) {
  const token = getD360Token();
  if (!token) {
    console.log("⚠️ D360 token ausente nas variáveis de ambiente.");
    return;
  }

  try {
    await axios.post(
      "https://waba.360dialog.io/v1/messages",
      {
        to,
        type: "text",
        text: { body: text },
      },
      {
        headers: {
          "Content-Type": "application/json",
          "D360-API-KEY": token,
        },
        timeout: 10000,
      }
    );
    console.log(`✅ Resposta enviada para ${to}`);
  } catch (err) {
    const msg = err?.response?.data || err.message;
    console.error("❌ Erro ao responder via 360:", msg);
  }
}

// Webhook POST (recebe eventos)
app.post("/webhook", async (req, res) => {
  try {
    // Log resumido do incoming
    console.log("📩 incoming:", JSON.stringify(req.body).slice(0, 2000));

    const number = extractSenderNumber(req.body);
    const text = extractMessageText(req.body);

    if (!number) {
      console.error("❌ Nenhum número encontrado");
      // Sempre responder 200 para o WhatsApp não repetir
      return res.status(200).send("ok");
    }

    console.log(`👤 Número detectado: ${number}${text ? " | texto: " + text : ""}`);

    // Resposta opcional automática (comente se não quiser)
    if (text) {
      await replyVia360(number, "Recebi sua mensagem 👍");
    }

    return res.status(200).send("ok");
  } catch (e) {
    console.error("🔥 Erro no webhook:", e);
    // Ainda assim devolve 200 para evitar reenvio em loop
    return res.status(200).send("ok");
  }
});

// (Opcional) Verificação GET do webhook para Cloud API / 360dialog se você usa challenge
app.get("/webhook", (req, res) => {
  // Ajuste conforme sua verificação; por padrão apenas responde 200
  res.status(200).send("ok");
});

app.listen(PORT, () => {
  console.log(`🚀 Kali server listening on :${PORT}`);
});

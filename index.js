// index.js (ESM)
import express from "express";
import axios from "axios";

const app = express();
app.use(express.json({ limit: "1mb" }));

// ===== ENV =====
const PORT = process.env.PORT || 8080;
const D360_API_KEY = process.env.D360_API_KEY || process.env.D360_API_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN; // opcional (Cloud API fallback)

// ===== HEALTH =====
app.get("/health", (_req, res) => res.status(200).send("ok"));

// ===== WEBHOOK =====
app.post("/webhook", async (req, res) => {
  // responde rápido ao provedor
  res.sendStatus(200);

  const value = req.body?.entry?.[0]?.changes?.[0]?.value || {};
  const msg = value?.messages?.[0];
  const from = msg?.from || value?.contacts?.[0]?.wa_id || null;
  const text = msg?.text?.body || "";

  console.log(
    "📥 POST /webhook | flags msgs:%s contacts:%s statuses:%s",
    !!msg,
    !!value?.contacts,
    !!value?.statuses
  );
  console.log("👤 numero=%s | texto=%s", from, JSON.stringify(text));

  if (!from) return console.log("⚠️  Nenhum número encontrado");
  const replyText = text ? `Recebi: "${text}"` : "Recebi sua mensagem 👋";

  // 1) Tenta 360 v2
  if (D360_API_KEY) {
    try {
      await send360_v2(from, replyText);
      return;
    } catch (e1) {
      console.log("🛑 360 v2 erro:", e1.status, e1.data || e1.message);
      // 2) Tenta 360 v1 (payload/headers alternativos)
      try {
        await send360_v1(from, replyText);
        return;
      } catch (e2) {
        console.log("🛑 360 v1 erro:", e2.status, e2.data || e2.message);
      }
    }
  } else {
    console.log("ℹ️ D360_API_KEY ausente — pulando 360");
  }

  // 3) Fallback Cloud API (se tiver token)
  const phoneNumberId = value?.metadata?.phone_number_id;
  if (WHATSAPP_TOKEN && phoneNumberId) {
    try {
      await sendCloudAPI(phoneNumberId, from, replyText, WHATSAPP_TOKEN);
      return;
    } catch (e3) {
      console.log("🛑 Cloud API erro:", e3.status, e3.data || e3.message);
    }
  } else {
    console.log("ℹ️ Cloud API fallback indisponível (sem WHATSAPP_TOKEN/phoneNumberId).");
  }

  console.log("❌ Todas as tentativas falharam.");
});

// ===== ENVIOS =====
async function send360_v2(to, body) {
  const url = "https://waba-v2.360dialog.io/v1/messages";
  const payload = {
    recipient_type: "individual",
    to: String(to),
    type: "text",
    text: { body }
  };
  const headers = {
    "Content-Type": "application/json",
    // alguns clusters aceitam Bearer, outros D360-API-KEY — enviamos ambos
    Authorization: `Bearer ${D360_API_KEY}`,
    "D360-API-KEY": D360_API_KEY
  };
  return postStrict(url, payload, headers);
}

async function send360_v1(to, body) {
  const url = "https://waba.360dialog.io/v1/messages";
  // variante mais “antiga” e tolerante
  const payload = {
    to: String(to),
    type: "text",
    text: { body, preview_url: false }
  };
  const headers = {
    "Content-Type": "application/json",
    "D360-API-KEY": D360_API_KEY // sem Authorization
  };
  return postStrict(url, payload, headers);
}

async function sendCloudAPI(phoneNumberId, to, body, token) {
  const url = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to: String(to),
    type: "text",
    text: { body }
  };
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json"
  };
  return postStrict(url, payload, headers);
}

// Post com throw detalhando status/data para o chamador decidir fallback
async function postStrict(url, payload, headers) {
  try {
    const r = await axios.post(url, payload, { headers, timeout: 15000 });
    console.log("✅ envio ok:", url, r.status, r.data?.meta || r.data);
    return r.data;
  } catch (err) {
    const status = err?.response?.status;
    const data = err?.response?.data;
    // Levanta erro com status/data pro fallback
    const e = new Error("send failed");
    e.status = status;
    e.data = data;
    throw e;
  }
}

// ===== START =====
app.listen(PORT, () => console.log(`🚀 listening :${PORT}`));

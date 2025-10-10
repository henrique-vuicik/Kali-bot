import express from "express";
import axios from "axios";

const app = express();
app.use(express.json({ limit: "1mb" }));

// ===== CONFIGURAÇÕES =====
const D360_API_KEY = process.env.D360_API_KEY;
const D360_URL = "https://waba-v2.360dialog.io/v1/messages"; // endpoint estável da 360
const PORT = process.env.PORT || 8080;

// ===== HEALTH =====
app.get("/health", (_req, res) => res.status(200).send("ok"));

// ===== WEBHOOK =====
app.post("/webhook", async (req, res) => {
  const value = req.body?.entry?.[0]?.changes?.[0]?.value;
  const msg = value?.messages?.[0];
  const from = msg?.from || value?.contacts?.[0]?.wa_id;
  const text = msg?.text?.body || "";

  console.log("📥 POST /webhook | flags msgs:%s contacts:%s statuses:%s",
    !!msg, !!value?.contacts, !!value?.statuses);
  console.log("🔎 raw(0..400):", JSON.stringify(req.body).slice(0, 400));
  console.log("👤 numero=%s | texto=\"%s\"", from, text);

  res.sendStatus(200); // responde rápido pro provedor

  if (!from) return console.log("⚠️  Nenhum número encontrado");
  if (!D360_API_KEY) return console.log("⚠️  D360_API_KEY ausente");

  const resposta = text ? `Recebi: "${text}"` : "Recebi sua mensagem 👋";
  await reply360(from, resposta);
});

// ===== FUNÇÃO DE ENVIO 360DIALOG =====
async function reply360(to, text) {
  const payload = {
    recipient_type: "individual",
    to: String(to),
    type: "text",
    text: { body: text }
  };

  try {
    const r = await axios.post(D360_URL, payload, {
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${D360_API_KEY}`,
        "D360-API-KEY": D360_API_KEY
      },
      timeout: 10000
    });
    console.log("✅ 360 ok:", r.status, r.data?.meta || r.data);
  } catch (err) {
    const status = err?.response?.status;
    const data = err?.response?.data;
    console.log("🛑 360 erro:", status, data || err.message);
  }
}

// ===== INICIA SERVIDOR =====
app.listen(PORT, () => console.log(`🚀 listening :${PORT}`));

import express from "express";
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;
const D360_API_KEY = process.env.D360_API_KEY?.trim();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY?.trim();

if (!D360_API_KEY) console.warn("⚠️ D360_API_KEY não configurado!");
if (!OPENAI_API_KEY) console.warn("⚠️ OPENAI_API_KEY não configurado!");

const memory = new Map();

/* ------------------------- Função: enviar mensagem ------------------------- */
async function sendText(to, body) {
  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: String(to),
    type: "text",
    text: { body: String(body) }
  };

  const resp = await fetch("https://waba-v2.360dialog.io/messages", {
    method: "POST",
    headers: {
      "D360-API-KEY": D360_API_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  console.log(`➡️  360 status: ${resp.status}`);
  if (!resp.ok) console.error(await resp.text());
}

/* --------------------------- Função: resposta IA --------------------------- */
async function aiReply(wa_id, userText) {
  const today = new Date().toLocaleDateString("pt-BR");
  if (!memory.has(wa_id)) memory.set(wa_id, { day: today, log: [], calories: 0 });

  const data = memory.get(wa_id);
  if (data.day !== today) {
    data.day = today;
    data.log = [];
    data.calories = 0;
  }

  const lower = userText.toLowerCase();

  // Reset de apresentação se perguntarem quem é
  if (["quem é você", "qual seu nome", "quem é a kali", "quem é kali"].some(q => lower.includes(q))) {
    return "Oi! Eu sou a *Kali*, assistente do Dr. Henrique. 🌙\nMeu nome vem de *caloria*! Fui criada pra te ajudar a somar o que você come, tirar dúvidas sobre nutrição, treino e medicações, e montar planos alimentares do seu jeito. 💪🍎";
  }

  // Tema fora de nutrição
  if (!/(caloria|comi|kcal|alimento|dieta|treino|proteína|carbo|gordura|medicação|suplemento|nutri|peso|alimentação|refeiç|shake|ovo|carne|arroz|leite|fruta|lanche)/i.test(lower)) {
    return "Esses assuntos eu deixo pro Dr. Henrique 😅, mas posso te ajudar com *nutrição, treino ou suplementação*. Quer seguir por aí?";
  }

  /* ---------------------- Consulta GPT-5 (resposta curta) ---------------------- */
  const messages = [
    {
      role: "system",
      content: `
        Você é *Kali*, assistente virtual de nutrição do Dr. Henrique.
        Fale de forma natural e amigável, como uma conversa no WhatsApp.
        Responda apenas sobre nutrição, treino, alimentação e medicações leves.
        Sempre que o paciente citar alimentos, calcule as calorias aproximadas e adicione ao subtotal diário.
        Mantenha um tom leve, curto e humano.
        Quando o paciente pedir "resumo", mostre o total de calorias do dia com emojis.
        Quando o paciente disser "limpar" ou "resetar", zere o subtotal.
      `
    },
    {
      role: "user",
      content: `
        Histórico de hoje: ${data.log.join(" | ")}.
        Subtotal atual: ${data.calories} kcal.
        Nova mensagem: "${userText}"
      `
    }
  ];

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-5",
      messages,
      temperature: 0.5,
      max_tokens: 250
    })
  });

  const json = await resp.json();
  let text = json.choices?.[0]?.message?.content?.trim() || "Não consegui entender bem. Pode repetir?";

  /* ------------------- Soma básica (número + 'kcal') ------------------- */
  const kcalMatch = text.match(/(\d+)\s?kcal/i);
  if (kcalMatch) {
    const kcal = parseInt(kcalMatch[1]);
    data.calories += kcal;
    data.log.push(`${userText} = ${kcal} kcal`);
    text += `\n\nSubtotal de hoje: *${data.calories} kcal* 🔥`;
  }

  if (/resumo/i.test(lower)) {
    text = data.log.length
      ? `📊 *Resumo de hoje:*\n${data.log.join("\n")}\n\n🔥 Total: *${data.calories} kcal*`
      : "Você ainda não registrou nada hoje. 🍽️";
  }

  if (/limpar|resetar/i.test(lower)) {
    data.log = [];
    data.calories = 0;
    text = "Memória diária apagada! Pode começar a registrar de novo. 🧘‍♀️";
  }

  memory.set(wa_id, data);
  return text;
}

/* ------------------------------ Webhook 360 ------------------------------ */
app.post("/webhook", async (req, res) => {
  res.sendStatus(200);
  const msg = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!msg) return;

  const from = msg.from;
  const text = msg.text?.body;
  if (!text) return;

  console.log(`💬 de ${from}: ${text}`);

  const reply = await aiReply(from, text);
  await sendText(from, reply);
});

/* ---------------------------- Health check ---------------------------- */
app.get("/", (req, res) => res.send("✅ Kali Nutro IA GPT-5 rodando com memória diária."));

app.listen(PORT, () => console.log(`🚀 Kali GPT-5 ativa na porta ${PORT}`));
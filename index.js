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

/* ------------------------- Envio WhatsApp ------------------------- */
async function sendText(to, body) {
  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: String(to),
    type: "text",
    text: { body: String(body) },
  };

  const resp = await fetch("https://waba-v2.360dialog.io/messages", {
    method: "POST",
    headers: {
      "D360-API-KEY": D360_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  console.log(`➡️ 360 status: ${resp.status}`);
  if (!resp.ok) console.error(await resp.text());
}

/* ------------------------- Geração de resposta ------------------------- */
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

  // Identificação e reset
  if (["quem é você", "qual seu nome", "quem é kali", "quem é a kali"].some(q => lower.includes(q))) {
    return "Oi! Eu sou a *Kali*, assistente do Dr. Henrique. 🌟\nMeu nome vem de *caloria*! Fui criada pra te ajudar a somar o que você come, tirar dúvidas sobre nutrição, treino e suplementação, e montar planos alimentares do seu jeito. 💪🍎";
  }

  // Limpar memória
  if (/limpar|resetar|zerar/i.test(lower)) {
    data.log = [];
    data.calories = 0;
    return "Memória apagada! Pode começar a registrar de novo 🧘‍♀️";
  }

  // Resumo do dia
  if (/resumo|total|quanto comi/i.test(lower)) {
    return data.log.length
      ? `📊 *Resumo de hoje:*\n${data.log.join("\n")}\n\n🔥 Total: *${data.calories} kcal*`
      : "Você ainda não registrou nada hoje. 🍽️ Me conte o que comeu!";
  }

  // Ignorar assuntos fora do contexto
  if (!/(comi|comida|almoço|janta|lanche|café|refeiç|bebida|caloria|dieta|proteína|carbo|gordura|alimento|nutri|shake|ovo|carne|arroz|frango|massa|salada|pizza|pastel|leite|iogurte|banana|fruta|pão|peixe|macarrão)/i.test(lower)) {
    return "Esses assuntos eu deixo pro Dr. Henrique 😅, mas posso te ajudar com *nutrição, treino ou suplementação*. Quer seguir por aí?";
  }

  /* --------------------- Chamada GPT-5 com prompt guiado --------------------- */
  const messages = [
    {
      role: "system",
      content: `
        Você é *Kali*, uma assistente de nutrição brasileira que ajuda o paciente do Dr. Henrique a somar calorias diárias e entender o que comeu.

        ⚙️ REGRAS:
        - Responda em até 3 linhas, de forma leve e natural.
        - Sempre calcule as calorias aproximadas de cada alimento citado, mesmo sem quantidade (use médias realistas).
        - Liste os alimentos e suas calorias estimadas.
        - Some o total da refeição e informe o subtotal diário.
        - Mantenha o foco apenas em alimentação, nutrição, treino ou suplementação.
        - Use emojis com moderação (🍎💪🔥).
        - Quando o usuário mandar algo como "resumo" ou "quanto comi", mostre tudo.
        - Quando o usuário disser "limpar" ou "resetar", zere o total.
        - Quando o texto não for relacionado a nutrição, diga que só responde sobre esses temas.
      `
    },
    {
      role: "user",
      content: `
        Histórico até agora: ${data.log.join(" | ")}.
        Subtotal atual: ${data.calories} kcal.
        Nova entrada: "${userText}".
        Calcule as calorias, atualize o total e responda com empatia.
      `
    }
  ];

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-5",
      messages,
      temperature: 0.4,
      max_tokens: 250,
    }),
  });

  const json = await resp.json();
  let text = json.choices?.[0]?.message?.content?.trim() || "Não consegui entender bem. Pode repetir?";

  // Extração de kcal da resposta
  const kcalMatch = text.match(/(\d+)\s?kcal/i);
  if (kcalMatch) {
    const kcal = parseInt(kcalMatch[1]);
    data.calories += kcal;
    data.log.push(`${userText} = ${kcal} kcal`);
    text += `\n\n🔥 Subtotal de hoje: *${data.calories} kcal*`;
  }

  memory.set(wa_id, data);
  return text;
}

/* ------------------------- Webhook WhatsApp ------------------------- */
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

/* ------------------------- Health Check ------------------------- */
app.get("/", (req, res) => res.send("✅ Kali Nutro IA GPT-5 (nutricionista esperta) rodando."));

app.listen(PORT, () => console.log(`🚀 Kali GPT-5 ativa na porta ${PORT}`));
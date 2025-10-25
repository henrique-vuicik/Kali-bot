import express from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch";

const app = express();
app.use(bodyParser.json());

// Variáveis de ambiente (Railway)
const PORT = process.env.PORT || 8080;
const D360_API_KEY = process.env.D360_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Endpoint padrão do 360dialog
const ENDPOINT_360 = "https://waba-v2.360dialog.io/v1/messages";

// Função simples de log
function log(color, msg, data = null) {
  const colors = {
    blue: "\x1b[34m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    red: "\x1b[31m",
    reset: "\x1b[0m",
  };
  console.log(`${colors[color] || ""}${msg}${colors.reset}`);
  if (data) console.log(data);
}

// Endpoint base (teste rápido)
app.get("/", (_, res) => res.send("✅ Kali Nutro IA está online e saudável! 🥦💪"));

// Webhook principal do WhatsApp
app.post("/webhook", async (req, res) => {
  log("blue", "🟦 Webhook recebido");

  const message = req.body.messages?.[0];
  if (!message) return res.sendStatus(200);

  const from = message.from;
  const text = message.text?.body || "";
  log("green", `🟩 Mensagem recebida de ${from}: ${text}`);

  // Prompt base com contexto da Kali
  const promptBase = `
  Você é **Kali**, uma assistente virtual de nutrologia da clínica do Dr. Henrique Vuicik.
  Seu papel é ajudar os pacientes a **monitorar a dieta, planejar refeições e entender o valor calórico dos alimentos**.
  - Fale de forma simpática, objetiva e encorajadora.  
  - Evite jargões médicos; use linguagem leiga e próxima.  
  - Dê **dicas práticas de alimentação** (ex: "troque pão por tapioca", "evite industrializados").  
  - Se o paciente mencionar refeições, calcule **estimativas de calorias**.  
  - Mantenha sempre o foco em **hábitos saudáveis, controle calórico e proteínas**.  
  - Caso o texto não seja sobre nutrição, responda brevemente e redirecione para alimentação.  
  Usuário: ${text}
  `;

  let respostaIA = "Desculpe, estou processando sua mensagem...";

  // Geração da resposta com OpenAI
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-5",
        input: promptBase,
      }),
    });

    const data = await response.json();
    respostaIA = data.output?.[0]?.content?.[0]?.text?.trim() || "Não consegui entender 😅";
    log("yellow", `🧠 Resposta IA: ${respostaIA}`);
  } catch (err) {
    log("red", "Erro ao consultar IA", err);
  }

  // Envio da resposta pelo WhatsApp
  try {
    const resp = await fetch(ENDPOINT_360, {
      method: "POST",
      headers: {
        "D360-API-KEY": D360_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: from,
        type: "text",
        text: { body: respostaIA },
      }),
    });

    const result = await resp.text();
    if (resp.ok) log("green", "✅ Resposta enviada com sucesso!");
    else log("red", `Erro ao enviar mensagem: ${result}`);
  } catch (err) {
    log("red", "Falha ao enviar mensagem", err);
  }

  res.sendStatus(200);
});

// Inicialização do servidor
app.listen(PORT, () => {
  log("green", `🚀 Kali Nutro IA rodando na porta ${PORT}`);
  log("blue", `🔔 Endpoint 360dialog: ${ENDPOINT_360}`);
  if (!D360_API_KEY) log("yellow", "⚠️ Falta D360_API_KEY nas variáveis do Railway!");
  if (!OPENAI_API_KEY) log("yellow", "⚠️ Falta OPENAI_API_KEY nas variáveis do Railway!");
});
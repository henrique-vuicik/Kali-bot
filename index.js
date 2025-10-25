const express = require("express");
const bodyParser = require("body-parser");

const app = express();
app.use(bodyParser.json());

// ---------- ENV ----------
const PORT = process.env.PORT || 8080;
const D360_API_KEY = process.env.D360_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ENDPOINT_360 = "https://waba-v2.360dialog.io/messages";
const DEFAULT_GOAL = Number(process.env.NUTRO_GOAL_KCAL || 2000);
const TZ = process.env.TIMEZONE || "America/Sao_Paulo";

// ---------- LOG ----------
function log(color, msg, data = null) {
  const colors = { blue: "\x1b[34m", green: "\x1b[32m", yellow: "\x1b[33m", red: "\x1b[31m", reset: "\x1b[0m" };
  console.log(`${colors[color] || ""}${msg}${colors.reset}`);
  if (data) console.log(typeof data === "string" ? data : JSON.stringify(data, null, 2));
}

// ---------- STATE (memória em RAM) ----------
/*
state = {
  "<wa_id>": {
    goal: 2000,
    days: {
      "2025-10-25": { total: 730, items: [ { text:"2 ovos…", kcal: 300 }, ... ] }
    }
  }
}
*/
const state = Object.create(null);
const todayKey = () => new Date().toLocaleDateString("en-CA", { timeZone: TZ }); // YYYY-MM-DD

function getUser(wa_id) {
  if (!state[wa_id]) state[wa_id] = { goal: DEFAULT_GOAL, days: {} };
  const key = todayKey();
  if (!state[wa_id].days[key]) state[wa_id].days[key] = { total: 0, items: [] };
  return { user: state[wa_id], day: state[wa_id].days[key], key };
}

// ---------- 360 helpers ----------
function extractMessage(body) {
  const value = body?.entry?.[0]?.changes?.[0]?.value;
  const msg = value?.messages?.[0];
  if (msg?.text?.body && msg?.from) {
    return { from: msg.from, text: msg.text.body.trim() };
  }
  return null;
}

async function sendMessage(to, text) {
  try {
    const payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { body: text },
    };

    const r = await fetch(ENDPOINT_360, {
      method: "POST",
      headers: { "D360-API-KEY": D360_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const resp = await r.text();
    if (r.ok) log("green", "✅ Resposta enviada!");
    else log("red", `❌ Erro 360dialog ${r.status}`, resp);
  } catch (err) {
    log("red", "❌ Erro ao enviar mensagem", err);
  }
}

// ---------- OpenAI ----------
async function openaiJSON(prompt) {
  // pedimos JSON estrito e robustecemos o parser
  const body = {
    model: "gpt-5",
    input:
      `Você é a **Kali**, assistente de nutrologia. ` +
      `Dado o texto do paciente, estime as calorias totais (kcal) e descreva um breve racional. ` +
      `Retorne **apenas** JSON no formato: {"kcal": <number>, "detalhe": "<string>"}.\n\n` +
      `Texto: "${prompt}"`,
  };

  try {
    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    log("yellow", "🧠 OpenAI raw:", data);

    // Tenta várias formas de extrair texto
    const candidates = [
      data.output?.[0]?.content?.[0]?.text,
      data.choices?.[0]?.message?.content,
      data.choices?.[0]?.text,
      typeof data === "string" ? data : null,
    ].filter(Boolean);

    const raw = candidates.find((t) => typeof t === "string" && t.trim());
    if (!raw) throw new Error("Sem texto na resposta da OpenAI");

    // Puxa o primeiro bloco JSON válido
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) throw new Error("JSON não encontrado no texto");
    const json = JSON.parse(raw.slice(start, end + 1));

    const kcal = Number(json.kcal);
    const detalhe = String(json.detalhe || "").trim();
    if (!isFinite(kcal)) throw new Error("kcal inválido");
    return { kcal: Math.max(0, Math.round(kcal)), detalhe };
  } catch (e) {
    log("red", "❌ Falha ao interpretar JSON da OpenAI", e.message || e);
    return null;
  }
}

// ---------- NLP simples de comandos ----------
function parseCommand(text) {
  const t = text.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
  if (/\b(total|saldo|resumo|quanto deu|quanto falta)\b/.test(t)) return { type: "total" };
  if (/\b(zerar|resetar|apagar|limpar)\b/.test(t)) return { type: "reset" };
  const metaMatch = t.match(/\bmeta\s+(\d{3,4})\b/);
  if (metaMatch) return { type: "set_goal", goal: Number(metaMatch[1]) };
  return { type: "meal" };
}

// ---------- Motor principal ----------
async function handleMeal(wa, userText) {
  const { user, day, key } = getUser(wa);

  const est = await openaiJSON(userText);
  if (!est) return "Tive um problema para calcular agora. Pode escrever de outro jeito? 😊";

  day.items.push({ text: userText, kcal: est.kcal, detalhe: est.detalhe });
  day.total += est.kcal;

  const restante = Math.max(0, user.goal - day.total);
  const msg =
    `✅ Anotei: ~${est.kcal} kcal\n` +
    (est.detalhe ? `🔎 ${est.detalhe}\n` : "") +
    `📅 ${key} | Parcial do dia: **${day.total} kcal** / meta **${user.goal} kcal**\n` +
    (restante > 0
      ? `🎯 Faltam ~${restante} kcal para a meta.\n` +
        `👉 Dica: priorize **proteína magra** (frango, ovos, iogurte), **fibra** (salada/legumes) e **água** para saciedade.`
      : `🎉 Você atingiu a meta do dia. Mantenha hidratação e foque em alimentos leves no restante do dia.`);
  return msg;
}

function handleTotal(wa) {
  const { user, day, key } = getUser(wa);
  const restante = Math.max(0, user.goal - day.total);
  const lista =
    day.items.length === 0
      ? "—"
      : day.items.map((it, i) => `${i + 1}. ${it.text} (~${it.kcal} kcal)`).join("\n");
  return (
    `📊 Resumo ${key}\n` +
    `Meta: ${user.goal} kcal\n` +
    `Consumido: ${day.total} kcal\n` +
    `Faltam: ${restante} kcal\n` +
    `Itens:\n${lista}`
  );
}

function handleReset(wa) {
  const { user } = getUser(wa);
  user.days[todayKey()] = { total: 0, items: [] };
  return "🔄 Zerei o total de hoje. Pode me enviar sua próxima refeição! 😊";
}

function handleSetGoal(wa, goal) {
  const { user } = getUser(wa);
  user.goal = Math.min(Math.max(goal, 800), 5000); // sanidade
  return `🎯 Nova meta diária definida: **${user.goal} kcal**.`;
}

// ---------- Routes ----------
app.get("/", (_, res) => res.send("✅ Kali Nutro IA Online 🥦"));

app.post("/webhook", async (req, res) => {
  log("blue", "🟦 Webhook recebido");
  const msg = extractMessage(req.body);
  if (!msg) {
    log("yellow", "🟨 Payload sem texto identificável.");
    return res.sendStatus(200);
  }

  const intent = parseCommand(msg.text);
  let reply;

  try {
    if (intent.type === "total") reply = handleTotal(msg.from);
    else if (intent.type === "reset") reply = handleReset(msg.from);
    else if (intent.type === "set_goal") reply = handleSetGoal(msg.from, intent.goal);
    else reply = await handleMeal(msg.from, msg.text);
  } catch (e) {
    log("red", "❌ Erro no fluxo", e);
    reply = "Deu um errinho aqui. Pode repetir a mensagem? 🙏";
  }

  await sendMessage(msg.from, reply);
  res.sendStatus(200);
});

// ---------- Start ----------
app.listen(PORT, () => {
  log("green", `🚀 Kali Nutro IA rodando na porta ${PORT}`);
  log("blue", `🔔 Endpoint 360dialog: ${ENDPOINT_360}`);
  if (!D360_API_KEY) log("yellow", "⚠️ Falta D360_API_KEY no Railway!");
  if (!OPENAI_API_KEY) log("yellow", "⚠️ Falta OPENAI_API_KEY no Railway!");
});
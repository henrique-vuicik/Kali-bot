// index.js
// Kali Nutro IA – WhatsApp (360dialog) + OpenAI
// Requisitos de ambiente: OPENAI_API_KEY, D360_API_KEY
// Node 18+ (tem fetch nativo). Sem node-fetch.

const express = require("express");
const crypto = require("crypto");

const app = express();
app.use(express.json({ limit: "1mb" }));

// ===== Config =====
const PORT = process.env.PORT || 8080;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const D360_API_KEY = process.env.D360_API_KEY;
const D360_BASE = "https://waba-v2.360dialog.io";
const D360_SEND = `${D360_BASE}/v1/messages`;

const NUTRO_SYSTEM = `
Você é a *Kali*, assistente de nutrologia focada em dieta e calorias.
Tarefas:
1) Interpretar texto livre em PT-BR sobre o que a pessoa comeu/bebeu.
2) Extrair itens com quantidade e unidade (quando possível).
3) Estimar *calorias por item* e *total*, com base em tabelas nutricionais comuns (valores médios, ok supor ranges).
4) Retornar *apenas JSON* no formato abaixo, sem texto fora do JSON:

{
  "items":[
    {"nome":"pão francês", "quantidade":2, "unidade":"fatia", "kcal":160},
    {"nome":"ovo", "quantidade":1, "unidade":"un", "kcal":70},
    {"nome":"café preto", "quantidade":1, "unidade":"xícara", "kcal":2}
  ],
  "total_kcal":232,
  "dica_curta":"Combine proteína magra em próximas refeições para maior saciedade."
}

Regras:
- Se o usuário não informar quantidade, estimar o *típico* (ex.: 1 xícara, 1 unidade, 100 g).
- Se algo for ambiguo, escolha o mais comum no Brasil.
- Não invente pratos não citados.
- Sempre some as calorias e preencha "total_kcal".
- "dica_curta" até 140 caracteres, prática e em linguagem simples.
`;

// --------- Utilidades ---------
const log = {
  info: (msg) => console.log(msg),
  blue: (msg) => console.log(`\x1b[34m${msg}\x1b[0m`),
  green: (msg) => console.log(`\x1b[32m${msg}\x1b[0m`),
  red: (msg) => console.error(`\x1b[31m${msg}\x1b[0m`),
  yellow: (msg) => console.warn(`\x1b[33m${msg}\x1b[0m`),
};

// --------- OpenAI ---------
async function callOpenAI(textoLivre) {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY ausente");
  }

  const body = {
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: NUTRO_SYSTEM },
      { role: "user", content: textoLivre },
    ],
    temperature: 0.2,
    response_format: { type: "json_object" },
  };

  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!r.ok) {
    const errText = await r.text().catch(() => "");
    throw new Error(`OpenAI ${r.status}: ${errText}`);
  }

  const data = await r.json();
  const content = data?.choices?.[0]?.message?.content || "{}";
  // Tenta parsear o JSON que pedimos
  try {
    return JSON.parse(content);
  } catch (e) {
    throw new Error("Falha ao interpretar JSON da OpenAI");
  }
}

// Fallback extremamente simples (caso OpenAI falhe): detecta alguns itens comuns
function fallbackEstimativa(texto) {
  const t = texto.toLowerCase();

  const lista = [];
  let total = 0;

  function add(nome, quant, un, kcalTotal) {
    lista.push({ nome, quantidade: quant, unidade: un, kcal: kcalTotal });
    total += kcalTotal;
  }

  // Heurísticas muito básicas (valores médios)
  const fatiasPao = (t.match(/fatia[s]? de p[aã]o|p[aã]o/gi) ? (parseInt(t.match(/(\d+)\s*(fatia|fatias)/)?.[1] || "2", 10)) : 0);
  if (fatiasPao > 0) add("pão (fatia)", fatiasPao, "fatia", fatiasPao * 80);

  const ovos = parseInt(t.match(/(\d+)\s*ovo[s]?/)?.[1] || (t.includes("ovo") ? "1" : "0"), 10);
  if (ovos > 0) add("ovo", ovos, "un", ovos * 70);

  if (t.includes("café preto") || t.includes("cafe preto") || t.includes("café")) {
    add("café preto", 1, "xícara", 2);
  }

  return {
    items: lista,
    total_kcal: total,
    dica_curta: "Hidrate-se e priorize proteínas nas próximas refeições.",
  };
}

// Monta texto de resposta amigável
function montarResposta(nomeUsuario, analise) {
  const itensTxt = analise.items
    .map(i => `• ${i.nome}: ${i.quantidade} ${i.unidade || ""} ≈ ${i.kcal} kcal`.replace(/\s+/g, " "))
    .join("\n");

  const total = analise.total_kcal || 0;

  let msg =
`Certo${nomeUsuario ? `, ${nomeUsuario}` : ""}! Aqui vai uma estimativa rápida:

${itensTxt || "• Não consegui identificar itens com segurança 😅"}

⚖️ *Total estimado*: *${total} kcal*
💡 ${analise.dica_curta || "Equilibre carboidratos com proteínas para saciedade."}

Se quiser, posso somar o *dia todo*. Me conte também o que rolou nas outras refeições.`;

  return msg;
}

// --------- WhatsApp (360dialog) ---------
async function sendWhatsAppText(toWaId, bodyText) {
  if (!D360_API_KEY) throw new Error("D360_API_KEY ausente");

  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: toWaId,
    type: "text",
    text: { preview_url: false, body: bodyText },
  };

  const r = await fetch(D360_SEND, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "D360-API-KEY": D360_API_KEY,
    },
    body: JSON.stringify(payload),
  });

  if (!r.ok) {
    const err = await r.text().catch(() => "");
    throw new Error(`Envio 360 falhou ${r.status}: ${err}`);
  }

  const data = await r.json().catch(() => ({}));
  return data;
}

// --------- Webhook ---------
app.get("/", (_req, res) => {
  log.blue("🔔 Endpoint 360dialog: " + D360_SEND);
  log.green("🚀 Kali Nutro IA rodando na porta " + PORT);
  res.send("OK");
});

app.post("/webhook", async (req, res) => {
  log.blue("🟦 Webhook recebido");

  try {
    const body = req.body;

    // Estrutura típica da 360dialog / Meta Webhook
    const change = body?.entry?.[0]?.changes?.[0];
    const value = change?.value;

    // Ignore eventos de status (entregue/lido/failed)
    const statuses = value?.statuses;
    if (Array.isArray(statuses) && statuses.length > 0) {
      return res.sendStatus(200);
    }

    const msg = value?.messages?.[0];
    const texto = msg?.text?.body?.trim();
    const from = msg?.from; // wa_id do remetente
    const profileName = value?.contacts?.[0]?.profile?.name;

    if (!texto || !from) {
      log.yellow("Webhook sem texto ou remetente identificável.");
      return res.sendStatus(200);
    }

    // Chama IA para entender/estimar
    let analise;
    try {
      analise = await callOpenAI(texto);
    } catch (e) {
      log.red("Falha OpenAI: " + e.message);
      analise = fallbackEstimativa(texto);
    }

    const resposta = montarResposta(profileName, analise);

    try {
      await sendWhatsAppText(from, resposta);
    } catch (e) {
      log.red("Falha ao enviar WhatsApp: " + e.message);
    }

    res.sendStatus(200);
  } catch (e) {
    log.red("Erro no webhook: " + e.message);
    res.sendStatus(200);
  }
});

// --------- Start ---------
app.listen(PORT, () => {
  log.green(`🚀 Kali Nutro IA rodando na porta ${PORT}`);
  log.blue(`🔔 Endpoint 360dialog: ${D360_SEND}`);
});
// index.js
// Kali Nutro IA – WhatsApp (360dialog) + OpenAI
// Requisitos: OPENAI_API_KEY, D360_API_KEY
// Node 18+ (fetch nativo). Não usa node-fetch.

const express = require("express");

const app = express();
app.use(express.json({ limit: "1mb" }));

// ===== Config =====
const PORT = process.env.PORT || 8080;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const D360_API_KEY = process.env.D360_API_KEY;

const D360_BASE = "https://waba-v2.360dialog.io";
const D360_V1 = `${D360_BASE}/v1/messages`;   // novo
const D360_LEGACY = `${D360_BASE}/messages`;   // fallback (este já deu 200 nos seus logs)

const NUTRO_SYSTEM = `
Você é a *Kali*, assistente de nutrologia focada em dieta e calorias.
Tarefas:
1) Interpretar texto livre em PT-BR sobre o que a pessoa comeu/bebeu.
2) Extrair itens com quantidade e unidade (quando possível).
3) Estimar *calorias por item* e *total*, usando valores médios.
4) Responder em *JSON puro* exatamente neste formato:

{
  "items":[
    {"nome":"pão francês","quantidade":2,"unidade":"fatia","kcal":160},
    {"nome":"ovo","quantidade":1,"unidade":"un","kcal":70},
    {"nome":"café preto","quantidade":1,"unidade":"xícara","kcal":2}
  ],
  "total_kcal":232,
  "dica_curta":"Combine proteína magra na próxima refeição."
}

Regras:
- Se não informarem quantidade, estime o típico no Brasil.
- Não invente itens não citados.
- Sempre preencha "total_kcal".
- "dica_curta" com até 140 caracteres, prática.
`;

// --------- Log helpers ---------
const log = {
  blue: (m) => console.log(`\x1b[34m${m}\x1b[0m`),
  green: (m) => console.log(`\x1b[32m${m}\x1b[0m`),
  yellow: (m) => console.warn(`\x1b[33m${m}\x1b[0m`),
  red: (m) => console.error(`\x1b[31m${m}\x1b[0m`),
};

// --------- OpenAI ---------
async function callOpenAI(textoLivre) {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY ausente");

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
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`OpenAI ${r.status}: ${t}`);
  }

  const data = await r.json();
  const content = data?.choices?.[0]?.message?.content || "{}";
  try {
    return JSON.parse(content);
  } catch {
    throw new Error("Falha ao interpretar JSON da OpenAI");
  }
}

// Fallback rápido se a IA der erro
function fallbackEstimativa(texto) {
  const t = (texto || "").toLowerCase();
  const itens = [];
  let total = 0;

  const add = (nome, q, un, kcal) => {
    itens.push({ nome, quantidade: q, unidade: un, kcal });
    total += kcal;
  };

  // heurísticas simples
  const fatias = parseInt(t.match(/(\d+)\s*(fatia|fatias)/)?.[1] || (t.includes("pão") ? "2" : "0"), 10);
  if (fatias > 0) add("pão (fatia)", fatias, "fatia", fatias * 80);

  const ovos = parseInt(t.match(/(\d+)\s*ovo[s]?/)?.[1] || (t.includes("ovo") ? "1" : "0"), 10);
  if (ovos > 0) add("ovo", ovos, "un", ovos * 70);

  if (t.includes("café")) add("café preto", 1, "xícara", 2);

  return {
    items: itens,
    total_kcal: total,
    dica_curta: "Hidrate-se e priorize proteína magra nas próximas refeições.",
  };
}

function montarResposta(nome, analise) {
  const itensTxt = (analise.items || [])
    .map(i => `• ${i.nome}: ${i.quantidade} ${i.unidade || ""} ≈ ${i.kcal} kcal`.replace(/\s+/g, " "))
    .join("\n");

  const total = analise.total_kcal || 0;

  return `Certo${nome ? `, ${nome}` : ""}! Aqui vai uma estimativa:

${itensTxt || "• Não consegui identificar itens com segurança 😅"}

⚖️ *Total estimado*: *${total} kcal*
💡 ${analise.dica_curta || "Equilibre carboidratos com proteínas para saciedade."}

Se quiser, posso somar o *dia todo*. Me conte as outras refeições.`;
}

// --------- Envio WhatsApp (com fallback de rota) ---------
async function sendWhatsAppText(toWaId, bodyText) {
  if (!D360_API_KEY) throw new Error("D360_API_KEY ausente");

  // payload padrão (Meta)
  const payloadV1 = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: toWaId,
    type: "text",
    text: { preview_url: false, body: bodyText },
  };

  // payload legacy (360dialog)
  const payloadLegacy = {
    to: toWaId,
    type: "text",
    text: { body: bodyText },
  };

  // 1) v1/messages
  const r1 = await fetch(D360_V1, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "D360-API-KEY": D360_API_KEY,
    },
    body: JSON.stringify(payloadV1),
  });

  if (r1.ok) {
    return await r1.json().catch(() => ({}));
  } else {
    const err1 = await r1.text().catch(() => "");
    console.error(
      `Falha v1/messages ${r1.status}. Payload: ${JSON.stringify(payloadV1)}. Resposta: ${err1}`
    );
  }

  // 2) /messages (legacy) — este já funcionou no seu ambiente
  const r2 = await fetch(D360_LEGACY, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "D360-API-KEY": D360_API_KEY,
    },
    body: JSON.stringify(payloadLegacy),
  });

  if (r2.ok) {
    return await r2.json().catch(() => ({}));
  } else {
    const err2 = await r2.text().catch(() => "");
    throw new Error(
      `Falha legacy /messages ${r2.status}. Payload: ${JSON.stringify(payloadLegacy)}. Resposta: ${err2}`
    );
  }
}

// --------- Webhook ---------
app.get("/", (_req, res) => {
  console.log();
  console.log("=============================================");
  console.log("Kali Nutro IA ativo");
  console.log("Envio primário:", D360_V1);
  console.log("Fallback legacy:", D360_LEGACY);
  console.log("=============================================");
  console.log();
  res.send("OK");
});

app.post("/webhook", async (req, res) => {
  log.blue("🟦 Webhook recebido");

  try {
    const body = req.body;
    const change = body?.entry?.[0]?.changes?.[0];
    const value = change?.value;

    // Ignora eventos de status
    if (Array.isArray(value?.statuses) && value.statuses.length > 0) {
      return res.sendStatus(200);
    }

    const msg = value?.messages?.[0];
    const texto = msg?.text?.body?.trim();
    const from = msg?.from; // wa_id
    const profileName = value?.contacts?.[0]?.profile?.name;

    if (!texto || !from) {
      log.yellow("Webhook sem texto ou remetente.");
      return res.sendStatus(200);
    }

    // Chama IA
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
  log.blue(`🔔 Endpoint primário: ${D360_V1}`);
});
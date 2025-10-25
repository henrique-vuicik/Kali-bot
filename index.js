const express = require("express");
const bodyParser = require("body-parser");

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 8080;
const D360_API_KEY = process.env.D360_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Endpoints 360dialog
const ENDPOINT_LEGACY = "https://waba-v2.360dialog.io/messages";
const ENDPOINT_V1 = "https://waba-v2.360dialog.io/v1/messages";

// Log colorido
function log(color, msg, data) {
  const c = {
    blue: "\x1b[34m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    red: "\x1b[31m",
    reset: "\x1b[0m",
  };
  console.log(`${c[color] || ""}${msg}${c.reset}`);
  if (data !== undefined) console.log(typeof data === "string" ? data : JSON.stringify(data, null, 2));
}

// ==== Helpers ====

// Extrai "from" e "text" do corpo do webhook (360dialog e Cloud API)
function extractIncoming(body) {
  // 1) Formato 360dialog (entry/changes/value/messages)
  const value = body?.entry?.[0]?.changes?.[0]?.value;
  const msg1 = value?.messages?.[0];
  if (msg1?.type === "text" && msg1?.from && msg1?.text?.body) {
    return { from: msg1.from.toString(), text: (msg1.text.body || "").trim(), raw: msg1 };
  }

  // 2) Formato Cloud API "direto" (raro aqui, mas suportamos)
  const msg2 = body?.messages?.[0];
  if (msg2?.type === "text" && msg2?.from && msg2?.text?.body) {
    return { from: msg2.from.toString(), text: (msg2.text.body || "").trim(), raw: msg2 };
  }

  // 3) Se veio só status (ex.: erro 131047 > janela 24h), retornamos null para ignorar
  const status = value?.statuses?.[0];
  if (status) {
    return { statusOnly: true, status };
  }

  return null;
}

async function askKaliNutro(userText) {
  const prompt = `
Você é **Kali**, assistente de nutrologia da clínica do Dr. Henrique Vuicik.
Objetivo: ajudar pacientes a monitorar calorias diárias, propor trocas inteligentes, priorizar proteínas e orientar hábitos saudáveis.
Regras:
- Seja simpática, objetiva e encorajadora.
- Explique em linguagem simples.
- Ao receber refeições/itens, estime calorias por alto.
- Sugira alternativas práticas e fáceis de aderir.
- Se o assunto fugir de nutrição, responda brevemente e puxe de volta ao tema alimentar.

Usuário: ${userText}
Responda em no máximo 5 linhas, com dicas práticas.
`;

  try {
    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-5",
        input: prompt,
      }),
    });

    const data = await r.json();
    log("yellow", "🧠 OpenAI bruto:", data);

    const text =
      data?.output?.[0]?.content?.[0]?.text?.trim() ||
      data?.choices?.[0]?.message?.content?.trim() || // fallback compat
      "Certo! Me diga o que você comeu hoje que eu te ajudo a estimar as calorias. 🙂";

    return text;
  } catch (e) {
    log("red", "Erro ao consultar OpenAI:", e);
    return "Tive um problema temporário para pensar a resposta. Pode repetir a pergunta?";
  }
}

// Envia via 360dialog (tenta variações conhecidas)
async function sendWhatsapp(to, bodyText) {
  const payloadBase = {
    to,
    type: "text",
    text: { body: bodyText },
  };

  // 1) LEGACY direto (sem messaging_product) – já funcionou contigo
  try {
    log("blue", `🟦 Enviando via: legacy -> ${ENDPOINT_LEGACY}`, payloadBase);
    const r1 = await fetch(ENDPOINT_LEGACY, {
      method: "POST",
      headers: {
        "D360-API-KEY": D360_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payloadBase),
    });
    const t1 = await r1.text();
    if (r1.ok) {
      log("green", "✅ Enviado (legacy)!", t1);
      return { ok: true, variant: "legacy" };
    }
    log("yellow", `⚠️ Legacy falhou (${r1.status})`, t1);

    // Caso o erro peça messaging_product, tentamos com esse campo
    const needsMP =
      t1.includes("messaging_product") ||
      t1.includes('(#100) The parameter messaging_product is required.');

    if (needsMP) {
      const payloadLegacyMP = {
        messaging_product: "whatsapp",
        ...payloadBase,
      };
      log("blue", `🟦 Enviando via: legacy + messaging_product -> ${ENDPOINT_LEGACY}`, payloadLegacyMP);
      const r1b = await fetch(ENDPOINT_LEGACY, {
        method: "POST",
        headers: {
          "D360-API-KEY": D360_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payloadLegacyMP),
      });
      const t1b = await r1b.text();
      if (r1b.ok) {
        log("green", "✅ Enviado (legacy + messaging_product)!", t1b);
        return { ok: true, variant: "legacy+mp" };
      }
      log("yellow", `⚠️ Legacy + MP falhou (${r1b.status})`, t1b);
    }
  } catch (e) {
    log("red", "Erro na tentativa legacy:", e);
  }

  // 2) V1/messages com messaging_product
  try {
    const payloadV1 = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      ...payloadBase,
      text: { preview_url: false, body: bodyText },
    };
    log("blue", `🟦 Enviando via: v1/messages -> ${ENDPOINT_V1}`, payloadV1);
    const r2 = await fetch(ENDPOINT_V1, {
      method: "POST",
      headers: {
        "D360-API-KEY": D360_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payloadV1),
    });
    const t2 = await r2.text();
    if (r2.ok) {
      log("green", "✅ Enviado (v1/messages)!", t2);
      return { ok: true, variant: "v1" };
    }
    log("yellow", `⚠️ v1/messages falhou (${r2.status})`, t2);
  } catch (e) {
    log("red", "Erro na tentativa v1/messages:", e);
  }

  return { ok: false, error: "Todas as variações falharam" };
}

// ==== Rotas ====

app.get("/", (_, res) => {
  res.send("✅ Kali Nutro IA online. Use /webhook (POST) para WhatsApp.");
});

app.post("/webhook", async (req, res) => {
  log("blue", "🟦 Webhook recebido");

  const parsed = extractIncoming(req.body);

  // Só status (ex.: erro 131047 - janela 24h)
  if (parsed?.statusOnly) {
    const st = parsed.status;
    log("yellow", "🟨 Webhook de status (sem texto):", st);
    // Se for 131047 (re-engagement), só template HSM resolve.
    // Aqui apenas logamos para você saber:
    if (st?.errors?.[0]?.code === 131047) {
      log(
        "yellow",
        "ℹ️ 131047 (Re-engagement): a janela de 24h expirou; só envia Template."
      );
    }
    return res.sendStatus(200);
  }

  if (!parsed) {
    log("yellow", "🟨 Não consegui extrair texto/remetente do webhook.", req.body);
    return res.sendStatus(200);
  }

  const { from, text } = parsed;
  log("green", "🟩 Mensagem recebida", { from, text });

  if (!from || !text) {
    log("yellow", "🟨 Sem 'from' ou 'text'. Ignorando.");
    return res.sendStatus(200);
  }

  // Gera resposta com IA
  const reply = await askKaliNutro(text);

  // Envia pelo WhatsApp
  const sent = await sendWhatsapp(from, reply);
  if (!sent.ok) {
    log("red", "🟥 Falhou envio em todas as variações.");
  }

  res.sendStatus(200);
});

// Start
app.listen(PORT, () => {
  log("green", `🚀 Kali Nutro IA rodando na porta ${PORT}`);
  log("blue", `🔔 Endpoint 360dialog: ${ENDPOINT_V1}`);
  if (!D360_API_KEY) log("yellow", "⚠️ Falta D360_API_KEY nas variáveis do Railway!");
  if (!OPENAI_API_KEY) log("yellow", "⚠️ Falta OPENAI_API_KEY nas variáveis do Railway!");
});
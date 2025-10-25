// index.js — Kali Nutro IA (texto + foto)
// Node 18+ (usa fetch nativo). Nenhuma dependência extra.

// ================== Config & Helpers ==================
const express = require("express");
const app = express();
app.use(express.json({ limit: "10mb" }));

const PORT = process.env.PORT || 8080;
const D360_API_KEY = process.env.D360_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const D360_BASE = "https://waba-v2.360dialog.io";

function logInfo(msg) {
  console.log(`\x1b[34m${msg}\x1b[0m`);
}
function logOk(msg) {
  console.log(`\x1b[32m${msg}\x1b[0m`);
}
function logWarn(msg) {
  console.log(`\x1b[33m${msg}\x1b[0m`);
}
function logErr(msg) {
  console.error(`\x1b[31m${msg}\x1b[0m`);
}

async function sendWhatsAppText(to, body) {
  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: { preview_url: false, body },
  };

  // Tenta v1/messages (360dialog)
  const r1 = await fetch(`${D360_BASE}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "D360-Api-Key": D360_API_KEY,
    },
    body: JSON.stringify(payload),
  });

  if (r1.ok) {
    const j = await r1.json().catch(() => ({}));
    logOk(`OK v1/messages: ${JSON.stringify(j)}`);
    return true;
  } else {
    const errText = await r1.text();
    logErr(`Falha v1/messages ${r1.status}. Payload: ${JSON.stringify(payload)}. Resposta: ${errText}`);
  }

  // Fallback para endpoint legacy (alguns workspaces ainda aceitam)
  const legacyPayload = {
    to,
    type: "text",
    text: { body },
  };

  const r2 = await fetch(`${D360_BASE}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "D360-Api-Key": D360_API_KEY,
    },
    body: JSON.stringify(legacyPayload),
  });

  if (r2.ok) {
    const j = await r2.json().catch(() => ({}));
    logOk(`OK legacy /messages: ${JSON.stringify(j)}`);
    return true;
  } else {
    const errText = await r2.text();
    logErr(`Falha legacy /messages ${r2.status}. Payload: ${JSON.stringify(legacyPayload)}. Resposta: ${errText}`);
    return false;
  }
}

// ================== OpenAI (texto) ==================
async function askOpenAIForCaloriesFromText(userText, nameHint) {
  const system = `
Você é a "Kali", uma assistente de nutrologia focada em dieta.
Tarefas:
1) Extrair os alimentos descritos pelo usuário (em PT-BR).
2) Estimar kcal por item e somar total.
3) Responder curto, simpático e objetivo. Use negrito em números importantes.
4) Se houver ambiguidade, assuma porções comuns (pão 1 fatia = 30g, ovo 1 un = 50g, café preto sem açúcar).
5) Dê 1 dica rápida e prática no final.
Formato:
• item: quantidade ≈ kcal
Total: **X kcal**
Dica: ...
  `.trim();

  const userPrompt = `
Nome: ${nameHint || "Paciente"}

Refeição descrita:
"${userText}"
  `.trim();

  const resp = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      input: [
        { role: "system", content: system },
        { role: "user", content: userPrompt },
      ],
      max_output_tokens: 400,
    }),
  });

  const json = await resp.json();
  // Responses API tem campo de conveniência:
  const out = json.output_text || "";
  return out.trim() || "Tive um problema para calcular agora. Pode escrever de outro jeito? 😊";
}

// ================== OpenAI (imagem) ==================
async function askOpenAIForCaloriesFromImage(dataUrl, caption, nameHint, mime) {
  const system = `
Você é a "Kali", uma assistente de nutrologia. A partir de UMA FOTO (e legenda, se tiver),
1) Identifique alimentos visíveis.
2) Estime porções realistas.
3) Calcule kcal por item e total.
4) Se a foto for ambígua, admita incerteza e peça 1 detalhe (ex.: tamanho do prato).
5) Resposta curta, clara, em PT-BR. Use negrito no total.
Formato:
• item: porção ≈ kcal
Total: **X kcal**
Dica: ...
  `.trim();

  const contentBlocks = [
    {
      type: "input_text",
      text: `Nome: ${nameHint || "Paciente"}\nLegenda informada: ${caption || "(sem legenda)"}`,
    },
    {
      type: "input_image",
      image_url: dataUrl, // data:<mime>;base64,<...>
    },
  ];

  const resp = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      input: [
        { role: "system", content: system },
        { role: "user", content: contentBlocks },
      ],
      max_output_tokens: 450,
    }),
  });

  const json = await resp.json();
  const out = json.output_text || "";
  return out.trim() || "Não consegui analisar bem a imagem agora. Pode mandar outra foto ou descrever o prato? 😊";
}

// ================== 360dialog — baixar mídia ==================
async function downloadMediaAsDataURL(mediaId, mimeHint) {
  // GET /v1/media/{media_id} retorna o binário
  const url = `${D360_BASE}/v1/media/${mediaId}`;
  const r = await fetch(url, {
    headers: { "D360-Api-Key": D360_API_KEY },
  });

  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`Falha ao baixar mídia ${mediaId}: ${r.status} ${t}`);
  }

  // Usa content-type retornado, se existir, senão o mime que veio do webhook
  const ct = r.headers.get("content-type") || mimeHint || "image/jpeg";
  const buf = Buffer.from(await r.arrayBuffer());
  const b64 = buf.toString("base64");
  const dataUrl = `data:${ct};base64,${b64}`;
  return { dataUrl, mime: ct };
}

// ================== Webhook ==================
app.get("/", (_, res) => {
  res.status(200).send("Kali Nutro IA — ok");
});

app.post("/webhook", async (req, res) => {
  logInfo("🟦 Webhook recebido");
  res.sendStatus(200); // responde rápido ao WhatsApp

  try {
    const body = req.body;

    // Estrutura 360dialog:
    // body.entry[0].changes[0].value.messages[0]
    const entry = body?.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;

    const messages = value?.messages;
    const metadata = value?.metadata;
    const toPhoneId = metadata?.phone_number_id; // não usamos aqui

    if (!messages || !messages.length) {
      // Pode ser status de entrega, ignore.
      return;
    }

    for (const msg of messages) {
      const from = msg.from; // wa_id do usuário
      const type = msg.type;
      const name = msg.profile?.name || "Paciente";

      if (!from) continue;

      // ===== Texto =====
      if (type === "text") {
        const text = msg.text?.body?.trim();
        if (!text) {
          await sendWhatsAppText(
            from,
            "Certo! Me diga o que você comeu que eu te ajudo a estimar as calorias. 😊"
          );
          continue;
        }

        // Se o texto parecer um comando simples (ex: "oi"), responda educativo
        if (text.toLowerCase() === "oi" || text.toLowerCase() === "menu") {
          await sendWhatsAppText(
            from,
            "Oi! Envie a refeição (ex: “2 fatias de pão, 1 ovo e café preto”) ou mande uma *foto do prato* que eu estimo as calorias. 📸🍽️"
          );
          continue;
        }

        const reply = await askOpenAIForCaloriesFromText(text, name).catch((e) => {
          logErr(`Erro OpenAI texto: ${e.message}`);
          return "Tive um problema para calcular agora. Pode escrever de outro jeito? 😊";
        });

        await sendWhatsAppText(from, reply);
        continue;
      }

      // ===== Imagem =====
      if (type === "image") {
        try {
          const mediaId = msg.image?.id;
          const caption = msg.image?.caption || msg.caption || "";
          const mime = msg.image?.mime_type || "image/jpeg";

          if (!mediaId) {
            await sendWhatsAppText(from, "Recebi a foto, mas não veio o ID da mídia. Pode reenviar? 😊");
            continue;
          }

          // Baixa a imagem do 360 e transforma em data URL base64
          const { dataUrl, mime: usedMime } = await downloadMediaAsDataURL(mediaId, mime);

          // Manda para a OpenAI (visão)
          const reply = await askOpenAIForCaloriesFromImage(dataUrl, caption, name, usedMime).catch((e) => {
            logErr(`Erro OpenAI imagem: ${e.message}`);
            return "Não consegui analisar a imagem agora. Pode mandar outra foto ou descrever o prato? 😊";
          });

          await sendWhatsAppText(from, reply);
        } catch (e) {
          logErr(`Falha fluxo imagem: ${e.message}`);
          await sendWhatsAppText(from, "Tive um problema ao baixar/analisar a foto. Pode tentar novamente? 🙏");
        }
        continue;
      }

      // ===== Outros tipos (áudio, sticker, etc.) =====
      await sendWhatsAppText(
        from,
        "Me envie *texto* com os alimentos ou uma *foto do prato* que eu calculo as calorias. 📸🍽️"
      );
    }
  } catch (e) {
    logErr(`Erro no webhook: ${e.message}\n${e.stack}`);
  }
});

// ================== Start ==================
app.listen(PORT, () => {
  logOk(`🚀 Kali Nutro IA rodando na porta ${PORT}`);
  logInfo(`🔔 Endpoint primário: ${D360_BASE}/v1/messages`);
});
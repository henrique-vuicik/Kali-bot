// index.js — Kali Nutro IA (texto + foto)
// Node 18+ (fetch nativo). Sem libs extras.

const express = require("express");
const app = express();
app.use(express.json({ limit: "15mb" }));

const PORT = process.env.PORT || 8080;
const D360_API_KEY = process.env.D360_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const D360_BASE = "https://waba-v2.360dialog.io";

// =============== Logs helpers ===============
const C = {
  blue: (s) => `\x1b[34m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
};
const logI = (m) => console.log(C.blue(m));
const logOK = (m) => console.log(C.green(m));
const logW = (m) => console.log(C.yellow(m));
const logE = (m) => console.error(C.red(m));

// =============== Envio WhatsApp ===============
async function sendWhatsAppText({ to, body, phoneNumberIdHint }) {
  const payloadStd = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: { preview_url: false, body },
  };

  // 1) v1/messages (padrão 360)
  {
    const url = `${D360_BASE}/v1/messages`;
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "D360-Api-Key": D360_API_KEY,
      },
      body: JSON.stringify(payloadStd),
    });
    if (r.ok) {
      const j = await r.json().catch(() => ({}));
      logOK(`OK v1/messages => ${JSON.stringify(j)}`);
      return true;
    } else {
      const t = await r.text().catch(() => "");
      logE(`Falha v1/messages ${r.status}. Payload: ${JSON.stringify(payloadStd)}. Resposta: ${t}`);
    }
  }

  // 2) v1/{phone_number_id}/messages (alguns tenants exigem essa rota)
  if (phoneNumberIdHint) {
    const url2 = `${D360_BASE}/v1/${phoneNumberIdHint}/messages`;
    const r2 = await fetch(url2, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "D360-Api-Key": D360_API_KEY,
      },
      body: JSON.stringify(payloadStd),
    });
    if (r2.ok) {
      const j = await r2.json().catch(() => ({}));
      logOK(`OK v1/{phone_id}/messages => ${JSON.stringify(j)}`);
      return true;
    } else {
      const t = await r2.text().catch(() => "");
      logE(`Falha v1/{phone_id}/messages ${r2.status}. URL: ${url2}. Resposta: ${t}`);
    }
  }

  // 3) /messages (LEGACY) — incluir messaging_product exigido pelo seu tenant
  const payloadLegacy = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body },
  };
  {
    const url3 = `${D360_BASE}/messages`;
    const r3 = await fetch(url3, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "D360-Api-Key": D360_API_KEY,
      },
      body: JSON.stringify(payloadLegacy),
    });
    if (r3.ok) {
      const j = await r3.json().catch(() => ({}));
      logOK(`OK legacy /messages => ${JSON.stringify(j)}`);
      return true;
    } else {
      const t = await r3.text().catch(() => "");
      logE(`Falha legacy /messages ${r3.status}. Payload: ${JSON.stringify(payloadLegacy)}. Resposta: ${t}`);
    }
  }

  return false;
}

// =============== OpenAI: texto ===============
async function askOpenAIForCaloriesFromText(userText, nameHint) {
  const system = `
Você é a "Kali", assistente de nutrologia.
Tarefas:
1) Extrair os alimentos descritos (PT-BR).
2) Estimar kcal por item e somar total.
3) Resposta curta, simpática e objetiva. Use negrito nos números-chave.
4) Assuma porções comuns quando necessário (pão fatia 30g; ovo 50g; café sem açúcar).
5) Inclua 1 dica prática.
Formato:
• item: quantidade ≈ kcal
Total: **X kcal**
Dica: ...
`.trim();

  const userPrompt = `Nome: ${nameHint || "Paciente"}\n\nRefeição:\n${userText}`;

  const r = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      input: [
        { role: "system", content: system },
        { role: "user", content: userPrompt },
      ],
      max_output_tokens: 450,
    }),
  });

  const j = await r.json().catch(() => ({}));
  const out = j.output_text || "";
  return out.trim() || "Tive um problema para calcular agora. Pode tentar descrever novamente? 😊";
}

// =============== OpenAI: imagem ===============
async function askOpenAIForCaloriesFromImage(dataUrl, caption, nameHint) {
  const system = `
Você é a "Kali", assistente de nutrologia. A partir de UMA FOTO (e legenda se houver):
1) Identifique alimentos e estime porções.
2) Calcule kcal por item e total.
3) Se a foto for incerta, admita incerteza e peça 1 detalhe (ex.: tamanho do prato).
4) Resposta curta em PT-BR, negrito no total.
Formato:
• item: porção ≈ kcal
Total: **X kcal**
Dica: ...
`.trim();

  const content = [
    { type: "input_text", text: `Nome: ${nameHint || "Paciente"}\nLegenda: ${caption || "(sem legenda)"}` },
    { type: "input_image", image_url: dataUrl },
  ];

  const r = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      input: [
        { role: "system", content: system },
        { role: "user", content },
      ],
      max_output_tokens: 500,
    }),
  });

  const j = await r.json().catch(() => ({}));
  const out = j.output_text || "";
  return out.trim() || "Não consegui analisar bem a imagem agora. Pode mandar outra foto ou descrever o prato? 😊";
}

// =============== 360dialog: download de mídia ===============
async function downloadMediaAsDataURL(mediaId, mimeHint) {
  const url = `${D360_BASE}/v1/media/${mediaId}`;
  logI(`Baixando mídia: id=${mediaId} url=${url}`);
  const r = await fetch(url, {
    method: "GET",
    headers: { "D360-Api-Key": D360_API_KEY },
    redirect: "follow",
  });

  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`Falha ao baixar mídia ${mediaId}: ${r.status} ${text}`);
  }

  const ct = r.headers.get("content-type") || mimeHint || "image/jpeg";
  const ab = await r.arrayBuffer();
  const b64 = Buffer.from(ab).toString("base64");
  const dataUrl = `data:${ct};base64,${b64}`;
  logOK(`Mídia baixada com content-type: ${ct}, bytes: ${ab.byteLength}`);
  return { dataUrl, mime: ct };
}

// =============== Webserver básico ===============
app.get("/", (_, res) => res.status(200).send("Kali Nutro IA — ok"));

// =============== Webhook ===============
app.post("/webhook", async (req, res) => {
  logI("🟦 Webhook recebido");
  // Responder rápido p/ evitar retry
  res.sendStatus(200);

  try {
    const body = req.body;
    const value = body?.entry?.[0]?.changes?.[0]?.value;
    const messages = value?.messages;
    const phoneNumberId = value?.metadata?.phone_number_id; // usar na via 2
    if (!messages?.length) return;

    for (const msg of messages) {
      const from = msg.from;
      const type = msg.type;
      const name = msg.profile?.name || "Paciente";
      if (!from) continue;

      // ===== TEXTO =====
      if (type === "text") {
        const text = msg.text?.body?.trim();
        if (!text) {
          await sendWhatsAppText({
            to: from,
            body: "Me diga o que você comeu ou envie uma *foto do prato* que eu estimo as calorias. 😊",
            phoneNumberIdHint: phoneNumberId,
          });
          continue;
        }

        const lower = text.toLowerCase();
        if (lower === "oi" || lower === "menu" || lower === "help") {
          await sendWhatsAppText({
            to: from,
            body:
              "Oi! Envie a refeição (ex: “2 fatias de pão, 1 ovo e café sem açúcar”) ou uma *foto do prato* que eu estimo as calorias. 📸🍽️",
            phoneNumberIdHint: phoneNumberId,
          });
          continue;
        }

        const reply = await askOpenAIForCaloriesFromText(text, name).catch((e) => {
          logE(`Erro OpenAI texto: ${e.message}`);
          return "Tive um problema para calcular agora. Pode tentar descrever novamente? 😊";
        });

        const ok = await sendWhatsAppText({
          to: from,
          body: reply,
          phoneNumberIdHint: phoneNumberId,
        });

        if (!ok) logE("Envio WhatsApp falhou para texto.");
        continue;
      }

      // ===== IMAGEM =====
      if (type === "image") {
        const mediaId = msg.image?.id;
        const caption = msg.image?.caption || msg.caption || "";
        const mime = msg.image?.mime_type || "image/jpeg";
        if (!mediaId) {
          await sendWhatsAppText({
            to: from,
            body: "Recebi a foto, mas não veio o ID da imagem. Pode reenviar? 🙏",
            phoneNumberIdHint: phoneNumberId,
          });
          continue;
        }

        try {
          const { dataUrl } = await downloadMediaAsDataURL(mediaId, mime);

          const reply = await askOpenAIForCaloriesFromImage(dataUrl, caption, name).catch((e) => {
            logE(`Erro OpenAI imagem: ${e.message}`);
            return "Não consegui analisar a imagem agora. Pode mandar outra foto ou descrever o prato? 😊";
          });

          const ok = await sendWhatsAppText({
            to: from,
            body: reply,
            phoneNumberIdHint: phoneNumberId,
          });
          if (!ok) logE("Envio WhatsApp falhou para imagem.");
        } catch (e) {
          logE(`Falha fluxo imagem: ${e.message}`);
          await sendWhatsAppText({
            to: from,
            body: "Tive um problema ao baixar/analisar a foto. Pode tentar novamente? 🙏",
            phoneNumberIdHint: phoneNumberId,
          });
        }
        continue;
      }

      // ===== Outros tipos =====
      await sendWhatsAppText({
        to: from,
        body: "Me envie *texto* com os alimentos ou uma *foto do prato* que eu calculo as calorias. 📸🍽️",
        phoneNumberIdHint: phoneNumberId,
      });
    }
  } catch (e) {
    logE(`Erro no webhook: ${e.message}\n${e.stack || ""}`);
  }
});

// =============== Start ===============
app.listen(PORT, () => {
  logOK(`🚀 Kali Nutro IA rodando na porta ${PORT}`);
  logI(`🔔 Endpoint primário: ${D360_BASE}/v1/messages`);
});
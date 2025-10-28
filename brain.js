// brain.js — ES Module
import OpenAI from "openai";

const apiKey = process.env.OPENAI_API_KEY;

// Cria cliente só se houver chave; caso contrário, cai em modo “eco”
const client = apiKey ? new OpenAI({ apiKey }) : null;

/**
 * Gera resposta inteligente para a mensagem de texto recebida.
 * Se não houver OPENAI_API_KEY, responde em modo fallback.
 */
export async function thinkReply(userText) {
  const prompt = String(userText || "").trim();

  if (!prompt) {
    return "Recebi sua mensagem. Como posso ajudar?";
  }

  // Fallback quando não há chave configurada
  if (!client) {
    return `Você disse: "${prompt}". (Modo simples ativo — configure a OPENAI_API_KEY para respostas inteligentes)`;
  }

  // ====== MODELO INTELIGENTE ======
  // Ajuste o nome do modelo se quiser; este funciona com a lib v4.x
  const system = "Você é a Kali Nutro IA. Responda de forma curta, simpática e útil.";
  const user = `Mensagem do usuário (WhatsApp): ${prompt}`;

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ],
      temperature: 0.4,
      max_tokens: 160
    });

    const text =
      completion?.choices?.[0]?.message?.content?.trim() ||
      "Certo! Como posso ajudar?";
    return text;
  } catch (err) {
    console.error("Erro na IA:", err);
    return "Tive um problema ao gerar a resposta agora. Pode tentar de novo?";
  }
}
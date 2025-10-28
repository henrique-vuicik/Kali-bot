// brain.js
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const memory = new Map(); // memória curta (wa_id -> histórico de mensagens)

// divide respostas longas
function chunkText(text, max = 3500) {
  const chunks = [];
  for (let i = 0; i < text.length; i += max) {
    chunks.push(text.slice(i, i + max));
  }
  return chunks;
}

// guarda contexto curto por usuário
function pushMemory(wa_id, role, content, limit = 6) {
  const arr = memory.get(wa_id) || [];
  arr.push({ role, content });
  while (arr.length > limit) arr.shift();
  memory.set(wa_id, arr);
  return arr;
}

// respostas prontas (intents rápidas)
function quickIntent(text) {
  const t = (text || '').toLowerCase().trim();

  if (/^menu$|opções|opcoes/.test(t)) {
    return "📋 Opções:\n1️⃣ Agendar consulta\n2️⃣ Planos e valores\n3️⃣ Orientações de dieta\n4️⃣ Falar com atendente";
  }
  if (/(agendar|agenda|marcar)/.test(t)) {
    return "🕐 Para agendar, envie: *nome completo + melhor horário*. Ou clique: https://wa.me/554299401345";
  }
  if (/(preço|valor|custos|planos)/.test(t)) {
    return "💰 Trabalho com planos mensais e trimestrais. Me conte seu objetivo que te indico o ideal.";
  }
  if (/(dieta|card[aá]pio|aliment(a|e)ção)/.test(t)) {
    return "🥦 Posso te ajudar! Me diga sua rotina (horários) e objetivo (peso, % de gordura).";
  }
  if (/(tirzepatida|mounjaro|zepa)/.test(t)) {
    return "💉 A Tirzepatida é usada para controle de peso e glicemia. Posso explicar como ela age e efeitos esperados.";
  }
  return null;
}

// resposta com IA
async function aiReply(wa_id, userText, profileName = 'Paciente') {
  const history = memory.get(wa_id) || [];

  const system = [
    "Você é a Kali, assistente de nutrologia do Dr. Henrique Vuicik.",
    "Fale em português, de forma breve, empática e profissional.",
    "Evite diagnósticos, mas explique de forma educativa.",
    "Convide o paciente para avaliação se necessário."
  ].join(' ');

  const messages = [
    { role: "system", content: system },
    ...history,
    { role: "user", content: userText }
  ];

  const resp = await openai.chat.completions.create({
    model: "gpt-5",
    messages,
    max_tokens: 250,
    temperature: 0.5
  });

  const text = resp.choices?.[0]?.message?.content?.trim() || "Certo!";
  pushMemory(wa_id, "user", userText);
  pushMemory(wa_id, "assistant", text);
  return text;
}

export { aiReply, quickIntent, chunkText };

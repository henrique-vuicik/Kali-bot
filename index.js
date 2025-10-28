// brain.js — ES Module
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

// memória simples em RAM (por wa_id)
const memory = new Map();

function getHistory(wa_id) {
  return memory.get(wa_id) || [];
}
function pushMemory(wa_id, role, content) {
  const arr = getHistory(wa_id);
  arr.push({ role, content, ts: Date.now() });
  // limita histórico para não estourar tokens
  while (arr.length > 12) arr.shift();
  memory.set(wa_id, arr);
}

function systemPrompt(profileName = 'Paciente') {
  return [
    'Você é a Kali, assistente de nutrologia do Dr. Henrique Vuicik.',
    'Fale em português, de forma breve, empática e orientativa.',
    'Evite diagnósticos fechados; ofereça educação, segurança e próximos passos.',
    'Se for tema clínico delicado, sugira avaliação presencial com o médico.',
    `O usuário chama-se ${profileName}.`
  ].join(' ');
}

/**
 * Gera a resposta da IA
 * @param {string} wa_id - número do WhatsApp do usuário
 * @param {string} userText - texto recebido do usuário
 * @param {string} profileName - nome do contato (opcional)
 * @returns {Promise<string>}
 */
export async function aiReply(wa_id, userText, profileName = 'Paciente') {
  // guarda a fala do usuário no histórico
  pushMemory(wa_id, 'user', userText);

  // monta mensagens p/ OpenAI
  const history = getHistory(wa_id)
    .map(m => ({ role: m.role, content: m.content }));

  const messages = [
    { role: 'system', content: systemPrompt(profileName) },
    ...history
  ];

  try {
    if (!process.env.OPENAI_API_KEY) {
      // fallback se não houver chave
      return 'Oi! Sou a Kali 😊. Posso te ajudar com dúvidas sobre nutrologia e seu acompanhamento.';
    }

    const resp = await client.chat.completions.create({
      model: OPENAI_MODEL,      // ajuste via env se quiser
      messages,
      max_tokens: 300,
      temperature: 0.5
    });

    const text =
      resp.choices?.[0]?.message?.content?.trim() ||
      'Certo! Como posso te ajudar?';

    // guarda resposta no histórico
    pushMemory(wa_id, 'assistant', text);
    return text;
  } catch (err) {
    console.error('Erro na IA:', err);
    return 'Tive um probleminha aqui para pensar sobre isso agora 😅. Pode repetir ou tentar de novo?';
  }
}
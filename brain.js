// brain.js — ES Module
import OpenAI from 'openai';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

// memória ingênua por usuário em RAM
const memory = new Map();
function getHistory(id) { return memory.get(id) || []; }
function pushMemory(id, role, content) {
  const arr = getHistory(id);
  arr.push({ role, content });
  while (arr.length > 12) arr.shift();
  memory.set(id, arr);
}

function sys(name='Paciente') {
  return [
    'Você é a Kali, assistente de nutrologia do Dr. Henrique Vuicik.',
    'Fale em português, breve, empática e orientativa.',
    'Evite diagnósticos fechados; priorize educação e segurança.',
    'Para casos clínicos, sugira avaliação com o médico.',
    `O usuário chama-se ${name}.`
  ].join(' ');
}

export async function aiReply(wa_id, userText, profileName='Paciente') {
  // sem chave? devolve resposta simples para não quebrar
  if (!process.env.OPENAI_API_KEY) {
    return 'Oi! Sou a Kali 😊. Posso ajudar com nutrologia e hábitos. Conte-me sua dúvida.';
  }

  pushMemory(wa_id, 'user', userText);

  const messages = [
    { role: 'system', content: sys(profileName) },
    ...getHistory(wa_id).map(m => ({ role: m.role, content: m.content }))
  ];

  try {
    const resp = await client.chat.completions.create({
      model: OPENAI_MODEL,
      messages,
      max_tokens: 300,
      temperature: 0.5
    });
    const text =
      resp.choices?.[0]?.message?.content?.trim() ||
      'Entendi! Como posso te ajudar?';
    pushMemory(wa_id, 'assistant', text);
    return text;
  } catch (e) {
    console.error('Erro na IA:', e);
    return 'Tive um probleminha para pensar nisso agora 😅. Pode repetir em outras palavras?';
  }
}
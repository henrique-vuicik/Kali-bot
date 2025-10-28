// index.js — Kali Nutro IA (Pro v4: conversa fluida)
// Requisitos: package.json { "type": "module" }, Node >=18
// Variáveis: D360_API_KEY, OPENAI_API_KEY

import express from 'express';
import dotenv from 'dotenv';
dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;
const D360_API_KEY = process.env.D360_API_KEY?.trim();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY?.trim();

// ---------------- Memória em processo ----------------
/*
ctx = {
  day: 'YYYY-MM-DD',
  log: [{whenISO,item,qty,unit,prep,kcal,protein_g,carb_g,fat_g,note}],
  profile: { likes:[], dislikes:[], restrictions:[], goals:'' },
  history: [{role:'user'|'assistant', content:string}], // últimas ~10
  pending: [{...items}] | null, // itens extraídos aguardando "pode somar"
  greeted: boolean // já se apresentou 1x para esse wa_id
}
*/
const state = new Map();
const todayStr = () => new Date().toISOString().slice(0,10);
function ensureCtx(wa_id){
  const day = todayStr();
  if(!state.has(wa_id)){
    state.set(wa_id, { day, log:[], profile:{}, history:[], pending:null, greeted:false });
  }
  const ctx = state.get(wa_id);
  if(ctx.day!==day){ ctx.day=day; ctx.log=[]; ctx.pending=null; }
  return ctx;
}
function pushHistory(ctx, role, content){
  ctx.history.push({ role, content: String(content).slice(0,800) });
  if(ctx.history.length>20) ctx.history.splice(0, ctx.history.length-20);
}
const sumKcal = (log)=> Math.round(log.reduce((s,i)=>s+(+i.kcal||0),0));

// ---------------- 360dialog ----------------
async function sendText(to, body){
  const payload = { messaging_product:'whatsapp', recipient_type:'individual', to:String(to), type:'text', text:{ body:String(body) } };
  try{
    const r = await fetch('https://waba-v2.360dialog.io/messages', {
      method:'POST',
      headers:{ 'D360-API-KEY':D360_API_KEY, 'Content-Type':'application/json','Accept':'application/json' },
      body: JSON.stringify(payload)
    });
    const t = await r.text();
    console.log(`➡️  360 status: ${r.status} body: ${t}`);
    return { status:r.status, body:t };
  }catch(e){
    console.error('❌ 360:', e); return { error:String(e) };
  }
}

// ---------------- OpenAI helpers ----------------
async function askOpenAI(messages, {json=false, temp=0.25, tokens=600}={}){
  const body = { model:'gpt-4o', messages, temperature:temp, max_tokens:tokens };
  if(json) body.response_format = { type:'json_object' };
  const res = await fetch('https://api.openai.com/v1/chat/completions',{
    method:'POST',
    headers:{ Authorization:`Bearer ${OPENAI_API_KEY}`, 'Content-Type':'application/json' },
    body: JSON.stringify(body)
  });
  if(!res.ok){ throw new Error(`OpenAI ${res.status}: ${await res.text()}`); }
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '';
}

// ---------------- Prompts ----------------
const SYSTEM_CORE = `
Você é a *Kali*, assistente do Dr. Henrique (nutrologia).
Aja em PT-BR, tom leve, direto, educado, com 1 emoji quando fizer sentido.
FOCO: nutrição (calorias/macros), treino/gasto, suplementação e medicações do metabolismo (sem prescrever; orientações gerais).
Se vier assunto fora do foco, responda em UMA linha redirecionando simpaticamente ao tema.
Ao registrar alimento, preferir estimar e deixar claro suposições entre parênteses.
Sempre que registrar item, retorne linha(s) + Subtotal do dia.

Formato linhas (sem markdown):
• [item] ([quantidade][un][, preparo?]): [kcal] kcal
Depois, "Subtotal do dia: [kcal] kcal" e instruções curtas.
`.trim();

const SYSTEM_PARSER = `
Extraia da mensagem dados de alimentos e intenção. Responda STRICT JSON:
{
 "items":[
   {"item":"string","qty":number,"unit":"g|ml|un","prep":"cru|cozido|assado|frito|nao_informado","kcal":number,
    "protein_g":number,"carb_g":number,"fat_g":number,"note":"se assumiu algo, ex.: (porção padrão 100g)"}
 ],
 "intent":"add|resume|reset|diet|identify|chat|confirm_add",
 "missing":"", 
 "reason":"curto motivo se não for possível"
}
Regras:
- "resumo|total|saldo": intent=resume
- "zerar|limpar|resetar": intent=reset
- "dieta|cardápio|plano": intent=diet
- "quem é você|qual seu nome|quem é a kali": intent=identify
- "soma|some|pode somar|adiciona|confirmo": intent=confirm_add
- Pode haver vários itens na mesma frase ("100g de carne e 100g de arroz").
- Se falta quantidade, assuma padrão realista (ex.: ovo 1un=70kcal ~50g; banana prata 90g; arroz cozido 100g; pastel 1un médio=250kcal).
- Se marca/preparo afetarem, estime e registre em "note".
`.trim();

// ---------------- Núcleo de nutrição ----------------
async function handleNutrition(wa_id, text){
  const ctx = ensureCtx(wa_id);

  // 1) apresentação só na 1ª interação do dia OU quando pedirem
  const isIdentifyQ = /(quem é você|qual seu nome|quem é a kali)/i.test(text);
  if((!ctx.greeted && /^(oi|ol[aá]|bom dia|boa tarde|boa noite)\b/i.test(text)) || isIdentifyQ){
    ctx.greeted = true;
    return `Oi! Eu sou a Kali, assistente do Dr. Henrique. Meu nome vem de *caloria*. Te ajudo a somar calorias do dia, tirar dúvidas e montar planos do seu jeito. O que você comeu por último? 🍽️`;
  }

  // 2) Parser tolerante
  let parsed;
  try{
    const content = await askOpenAI(
      [
        { role:'system', content:SYSTEM_PARSER },
        ...ctx.history.slice(-6), // dá contexto para "e o resto?"
        { role:'user', content:text }
      ],
      { json:true, temp:0.1 }
    );
    parsed = JSON.parse(content);
  }catch(e){
    console.error('Parser falhou:', e.message);
    // pergunta objetiva em vez de "não entendi"
    return `Me diz o alimento e a quantidade (ex.: "200 g de frango grelhado" ou "1 banana"). Posso estimar mesmo sem todos os detalhes. 🙂`;
  }

  // 3) Intenções utilitárias
  const intent = parsed.intent || 'chat';

  if(intent==='resume'){
    if(!ctx.log.length) return `Por aqui tá zerado. Me diga o que você comeu que eu somo.`;
    const linhas = ctx.log.map(i=>`• ${i.item} (${i.qty}${i.unit}${i.prep&&i.prep!=='nao_informado'?`, ${i.prep}`:''}): ${Math.round(i.kcal)} kcal`);
    return `${linhas.join('\n')}\n\nTotal do dia: ${sumKcal(ctx.log)} kcal\n(Envie "zerar" para limpar ou continue mandando o que comeu.)`;
  }

  if(intent==='reset'){
    ctx.log=[]; ctx.pending=null;
    return `Prontinho, limpei seu dia. Manda o próximo alimento que eu somo.`;
  }

  if(intent==='diet'){
    // coleta preferências se ainda não houver
    const needs = !ctx.profile.likes && !ctx.profile.goals;
    if(needs){
      return `Fecho junto contigo! Antes, me diz rapidinho:\n1) Quantas refeições prefere no dia?\n2) O que você curte comer? (ex.: ovos, iogurte, frango, arroz)\n3) Algo a evitar?\n4) Meta de kcal/proteína (se tiver).`;
    }
    try{
      const plan = await askOpenAI([
        { role:'system', content:SYSTEM_CORE },
        ...ctx.history.slice(-6),
        { role:'user', content:`Com base nas preferências que eu já te falei, monte um cardápio de 1 dia com porções em g/ml, macros por refeição e total diário.` }
      ], { temp:0.3, tokens:900 });
      return plan;
    }catch(e){
      return `Tive um pico aqui. Me manda suas preferências e metas em uma mensagem só que eu monto já em seguida.`;
    }
  }

  // 4) Confirmar itens pendentes (usuário disse "pode somar")
  if(intent==='confirm_add'){
    if(!ctx.pending?.length) return `Me diz o alimento e a quantidade que eu já somo aqui.`;
    for(const it of ctx.pending){ ctx.log.push(it); }
    const added = ctx.pending.map(rec=>`• ${rec.item} (${rec.qty}${rec.unit}${rec.prep&&rec.prep!=='nao_informado'?`, ${rec.prep}`:''}): ${Math.round(rec.kcal)} kcal`);
    ctx.pending = null;
    return `${added.join('\n')}\n\nSubtotal do dia: ${sumKcal(ctx.log)} kcal\n("resumo" para ver tudo, ou continue mandando o que comeu.)`;
  }

  // 5) Registrar itens (ou deixar pendente se estiver ambíguo)
  if(parsed.items?.length){
    // Transforma itens em registros padronizados
    const regs = parsed.items.map(it=>({
      whenISO: new Date().toISOString(),
      item: it.item,
      qty: Number(it.qty)||1,
      unit: it.unit||'un',
      prep: it.prep||'nao_informado',
      kcal: Number(it.kcal)||0,
      protein_g: Number(it.protein_g)||0,
      carb_g: Number(it.carb_g)||0,
      fat_g: Number(it.fat_g)||0,
      note: it.note||''
    }));

    // Heurística: se o parser sinalizou "missing" e for algo crítico (ex.: quantidade),
    // **mantém pendente** e pede só o que falta, mas já mostra a prévia.
    const missing = (parsed.missing||'').toLowerCase();
    if(missing.includes('quant') || missing.includes('gram') || missing.includes('ml')){
      ctx.pending = regs;
      const preview = regs.map(r=>`• ${r.item} (${r.qty}${r.unit}${r.prep&&r.prep!=='nao_informado'?`, ${r.prep}`:''}): ~${Math.round(r.kcal)} kcal`).join('\n');
      return `${preview}\n\nSó me confirma a quantidade exata pra eu somar de vez, pode ser?`;
    }

    // Caso normal: soma direto
    const added = [];
    for(const r of regs){ ctx.log.push(r); added.push(`• ${r.item} (${r.qty}${r.unit}${r.prep&&r.prep!=='nao_informado'?`, ${r.prep}`:''}): ${Math.round(r.kcal)} kcal`); }
    return `${added.join('\n')}\n\nSubtotal do dia: ${sumKcal(ctx.log)} kcal\n(Diga "resumo" para ver tudo, "zerar" para limpar, ou continue mandando o que comeu.)`;
  }

  // 6) Chat dentro do foco (nutrição/treino/suplementos) — fluido
  try{
    const reply = await askOpenAI([
      { role:'system', content:SYSTEM_CORE },
      ...ctx.history.slice(-6),
      { role:'user', content:text }
    ], { temp:0.35, tokens:450 });
    return reply.length>2 ? reply : `Me conta o alimento e a quantidade que eu já somo aqui.`;
  }catch(e){
    return `Pode me dizer o alimento e a quantidade? Ex.: "1 pastel de queijo" ou "120 g de arroz cozido".`;
  }
}

// ---------------- Rotas ----------------
app.get('/', (_req,res)=> res.send('✅ Kali Nutro IA Pro v4 online'));

app.post('/webhook', async (req,res)=>{
  try{
    console.log('🟦 Webhook recebido');
    console.log('↩️ body:', JSON.stringify(req.body));
    res.status(200).send('OK');

    const value = req.body?.entry?.[0]?.changes?.[0]?.value;
    const msgs = value?.messages;
    if(!Array.isArray(msgs)) return;

    for(const msg of msgs){
      const from = msg.from;
      const type = msg.type;
      const ctx = ensureCtx(from);

      if(type !== 'text' || !msg.text?.body){
        await sendText(from, 'Me manda por texto pra eu somar certinho as calorias, por favor 😉');
        continue;
      }

      const text = String(msg.text.body||'').trim();
      console.log(`💬 de ${from}: ${text}`);
      pushHistory(ctx,'user',text);

      // Soft off-topic: só redireciona sem travar
      const off = /(quem descobriu|porsche|cotação|política|história do brasil|futebol|clima|tempo|imposto|trânsito)/i;
      if(off.test(text)){
        const nudge = 'Eu fico no time da nutrição, treino e suplementação 😉. Quer falar do que você comeu agora ou tirar uma dúvida de alimentos?';
        pushHistory(ctx,'assistant',nudge);
        await sendText(from, nudge);
        continue;
      }

      let out = await handleNutrition(from, text);

      // Atualiza histórico e envia
      pushHistory(ctx,'assistant',out);
      await sendText(from, out);
    }
  }catch(e){
    console.error('🔥 Erro /webhook:', e);
    try{ res.status(500).send('erro'); }catch{}
  }
});

// Teste manual
app.post('/send', async (req,res)=>{
  const {to, body} = req.body||{};
  if(!to||!body) return res.status(400).json({error:'to e body obrigatórios'});
  const r = await sendText(to, body);
  res.json(r);
});

app.listen(PORT, ()=>{
  console.log(`🚀 Kali Nutro IA Pro v4 rodando na porta ${PORT}`);
  console.log(`🔔 Endpoint 360: https://waba-v2.360dialog.io/messages`);
  if(!D360_API_KEY) console.warn('⚠️ D360_API_KEY não configurado');
  if(!OPENAI_API_KEY) console.warn('⚠️ OPENAI_API_KEY não configurado');
});
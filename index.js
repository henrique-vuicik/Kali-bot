// index.js — Kali Nutro IA focada em nutrição, com soma de calorias e memória diária

import express from 'express';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;
const D360_API_KEY = process.env.D360_API_KEY?.trim();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY?.trim();

// --- Sessões em memória (por usuário) ---
/**
 * Estrutura:
 * sessions[wa_id] = {
 *   date: 'YYYY-MM-DD',
 *   items: [{ desc, kcal }],
 *   total: number
 * }
 */
const sessions = Object.create(null);
const todayStr = () => new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD

// --- Tabela simples de alimentos (kcal por unidade base) ---
const FOOD_DB = [
  // por 100 g
  { key: /arroz( branco)?( cozido)?/i, base: '100g', kcal: 128 },
  { key: /(carne|bife|patinho|coxão|alcatra)/i, base: '100g', kcal: 250 },    // média
  { key: /(frango|peito de frango)/i, base: '100g', kcal: 165 },
  { key: /(banana)/i, base: '100g', kcal: 89 },
  { key: /(salada de frutas?)/i, base: '100g', kcal: 60 },

  // por unidade
  { key: /(ovo( frito)?)/i, base: '1un', kcal: 90 },
  { key: /(pastel de carne)/i, base: '1un', kcal: 300 },
];

// Conversões simples
const parseNumber = (s) => {
  if (!s) return null;
  const n = Number(String(s).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

// Estima kcal a partir de texto
function estimateCalories(text) {
  const parts = [];

  // Quebra frases por " e ", "," etc.
  const chunks = String(text).split(/(?:\se\s|,|\+|\s\+\s)/i).map(s => s.trim()).filter(Boolean);

  for (const chunk of chunks) {
    let matched = false;

    for (const f of FOOD_DB) {
      if (f.key.test(chunk)) {
        matched = true;

        // quantidade em g/ml/unidade
        // procura padrão "100g", "150 g", "400ml", "2 ovos", "1 ovo"
        let qtyG = null, qtyMl = null, qtyUn = null;

        const mG = chunk.match(/(\d+(?:[.,]\d+)?)\s*(g|gramas?)/i);
        const mMl = chunk.match(/(\d+(?:[.,]\d+)?)\s*(ml|mL)/i);
        const mUn = chunk.match(/(\d+(?:[.,]\d+)?)\s*(un|uni|unid|unidade|ovos?|past[eé]is)/i);

        if (mG) qtyG = parseNumber(mG[1]);
        if (mMl) qtyMl = parseNumber(mMl[1]);
        if (mUn) qtyUn = parseNumber(mUn[1]);

        // heurística: 1 ml ≈ 1 g para salada de frutas / líquidos
        if (!qtyG && qtyMl) qtyG = qtyMl;

        let kcal = 0;
        let labelQty = '';

        if (f.base === '100g') {
          const q = qtyG ?? 100; // se não informado, assume 100g
          kcal = (q / 100) * f.kcal;
          labelQty = `${q}g`;
        } else if (f.base === '1un') {
          const q = qtyUn ?? 1;
          kcal = q * f.kcal;
          labelQty = `${q} un`;
        }

        parts.push({
          desc: `${chunk} (${labelQty})`,
          kcal: Math.round(kcal),
        });
        break;
      }
    }

    // não casou nada conhecido: ignora para a soma, o GPT pode responder separadamente
    if (!matched) {
      // noop
    }
  }

  return parts;
}

// --- Envio via 360dialog v2 ---
async function sendText(to, body) {
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: String(to),
    type: 'text',
    text: { body: String(body).slice(0, 4096) }
  };

  try {
    const resp = await fetch('https://waba-v2.360dialog.io/messages', {
      method: 'POST',
      headers: {
        'D360-API-KEY': D360_API_KEY,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const txt = await resp.text();
    console.log(`➡️  360 status: ${resp.status} body: ${txt}`);
    return { status: resp.status, body: txt };
  } catch (err) {
    console.error('❌ Erro 360:', err);
    return { error: String(err) };
  }
}

// --- Auxiliar de sessão ---
function getSession(wa_id) {
  const d = todayStr();
  const s = sessions[wa_id];
  if (!s || s.date !== d) {
    sessions[wa_id] = { date: d, items: [], total: 0 };
  }
  return sessions[wa_id];
}

function addItems(wa_id, items) {
  const s = getSession(wa_id);
  for (const it of items) {
    s.items.push(it);
    s.total += it.kcal;
  }
  s.total = Math.round(s.total);
  return s;
}

function summarize(wa_id) {
  const s = getSession(wa_id);
  if (!s.items.length) return 'Ainda não registrei nada hoje. Me diga o que você comeu (ex: "2 ovos e 100g de arroz").';
  const lines = s.items.map(it => `• ${it.desc}: ${it.kcal} kcal`);
  lines.push(`\nSubtotal do dia: ${s.total} kcal`);
  return lines.join('\n');
}

// --- Healthcheck ---
app.get('/', (req, res) => res.send('✅ Kali Nutro IA ativa (nutrição + soma de calorias)'));

// --- Webhook ---
app.post('/webhook', async (req, res) => {
  try {
    console.log('🟦 Webhook recebido');
    // responde rápido
    res.status(200).send('OK');

    const value = req.body?.entry?.[0]?.changes?.[0]?.value;
    const msg = value?.messages?.[0];
    if (!msg) return;

    const from = msg.from;
    const type = msg.type;

    console.log(`💬 de ${from}: tipo=${type}`);

    if (type !== 'text' || !msg.text?.body) {
      await sendText(from, 'Posso te ajudar registrando refeições e somando calorias. Me diga o que você comeu. 🙂');
      return;
    }

    const text = msg.text.body.trim();

    // Comandos rápidos
    if (/^(resumo|total|como estou)\b/i.test(text)) {
      return void (await sendText(from, summarize(from)));
    }
    if (/^(zerar|reset|apagar)\b/i.test(text)) {
      sessions[from] = { date: todayStr(), items: [], total: 0 };
      return void (await sendText(from, 'Ok! Zerado para hoje. Me diga sua próxima refeição. 😉'));
    }
    if (/^(fechar dia|finalizar dia)\b/i.test(text)) {
      const s = getSession(from);
      const final = summarize(from);
      sessions[from] = { date: todayStr(), items: [], total: 0 };
      return void (await sendText(from, `Fechando o dia:\n${final}\n\nDia reiniciado. 🌙➡️🌞`));
    }

    // Estimativa e soma de calorias (regra local)
    const items = estimateCalories(text);
    if (items.length) {
      const s = addItems(from, items);
      const linhas = items.map(it => `• ${it.desc}: ${it.kcal} kcal`).join('\n');
      await sendText(
        from,
        `${linhas}\n\nSubtotal do dia: ${s.total} kcal\n(Diga "resumo" para ver tudo, ou continue mandando o que comeu.)`
      );
      return;
    }

    // Dúvidas gerais (nutrição/treino/medicação) — via OpenAI com guarda de escopo
    if (OPENAI_API_KEY) {
      const completion = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          temperature: 0.3,
          max_tokens: 300,
          messages: [
            {
              role: 'system',
              content:
                "Você é a Kali, assistente do Dr. Henrique. Tom: leve, direta e prática. Limites: só responda sobre nutrição, treino ou medicação relacionada a emagrecimento/saúde metabólica. Se o assunto não for desses, responda: 'Posso te ajudar com nutrição, treino e medicamentos. Quer falar sobre sua alimentação de hoje?'. Quando o usuário citar alimentos/quantidades, seja objetiva e peça unidade se faltar (g, ml, unidade). Não assine, não use rodapé."
            },
            { role: 'user', content: text }
          ]
        })
      });

      if (completion.ok) {
        const data = await completion.json();
        const out = data?.choices?.[0]?.message?.content?.trim();
        if (out) return void (await sendText(from, out));
      }

      // fallback
      return void (await sendText(from, 'Posso te ajudar com nutrição, treino e medicamentos. Me diga o que você comeu que eu somo por aqui. 🙂'));
    } else {
      return void (await sendText(from, 'Me diga o que você comeu (ex: "1 ovo e 150g de arroz") que eu somo as calorias. 😉'));
    }
  } catch (err) {
    console.error('🔥 Erro no /webhook:', err);
    try { res.status(200).end(); } catch {}
  }
});

// Envio manual
app.post('/send', async (req, res) => {
  const { to, body } = req.body || {};
  if (!to || !body) return res.status(400).json({ error: 'to e body obrigatórios' });
  const r = await sendText(to, body);
  res.json(r);
});

app.listen(PORT, () => {
  console.log(`🚀 Kali Nutro IA ativa na porta ${PORT}`);
  console.log(`🔔 Endpoint 360: https://waba-v2.360dialog.io/messages`);
});
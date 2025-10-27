require('dotenv').config();
const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json({ limit: '5mb' }));

// ==== ENV ====
const PORT = process.env.PORT || 8080;
const D360_URL = process.env.D360_URL || 'https://waba-v2.360dialog.io/v1/messages';
const D360_TOKEN = process.env.D360_TOKEN;               // -> Token 360dialog (NÃO o Cloud)
const TEST_TO = process.env.TEST_TO || process.env.FALLBACK_TO || ''; // opcional

if (!D360_TOKEN) {
  console.error('❌ D360_TOKEN não definido. Configure nas Variables do Railway.');
}

// ==== Helpers ====
async function sendText360(to, body) {
  if (!to) throw new Error('destinatário (to) vazio');
  const payload = {
    to,
    type: 'text',
    text: { body, preview_url: false }
  };
  try {
    const res = await axios.post(D360_URL, payload, {
      headers: {
        'D360-API-KEY': D360_TOKEN,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    });
    return res.data;
  } catch (err) {
    const data = err.response?.data;
    console.error('❌ Falha 360 v1/messages:', data || err.message);
    throw err;
  }
}

// Estimativa simples de calorias por texto (estável)
function estimateCalories(text) {
  if (!text || !text.trim()) return { items: [], total: 0, tip: 'Descreva sua refeição (ex: 2 ovos, 1 pão, café).' };

  const db = [
    { k: /ovo(s)? frito/i, kcal: 90, unit: '1 un' },
    { k: /ovo(s)? cozido/i, kcal: 78, unit: '1 un' },
    { k: /ovo(s)?/i, kcal: 70, unit: '1 un' },
    { k: /p[aã]o franc[eê]s/i, kcal: 140, unit: '1 un' },
    { k: /p[aã]o integral/i, kcal: 110, unit: '1 fatia' },
    { k: /p[aã]o/i, kcal: 80, unit: '1 fatia' },
    { k: /banana/i, kcal: 90, unit: '1 un média' },
    { k: /ma[çc][aã]/i, kcal: 80, unit: '1 un média' },
    { k: /arroz/i, kcal: 170, unit: '100 g' },
    { k: /feij[aã]o/i, kcal: 95, unit: '100 g' },
    { k: /frango/i, kcal: 165, unit: '100 g' },
    { k: /bife|carne/i, kcal: 250, unit: '150 g' },
    { k: /café preto/i, kcal: 2, unit: '1 xíc' },
    { k: /café/i, kcal: 20, unit: '1 xíc c/ açúcar' },
    { k: /suco/i, kcal: 100, unit: '200 ml' },
  ];

  const items = [];
  let total = 0;

  for (const row of db) {
    const m = text.match(row.k);
    if (m) {
      // tentativa de capturar quantidade (ex: "2 ovos")
      const qMatch = text.match(new RegExp(`(\\d+[\\.,]?\\d*)\\s*${row.k.source}`, 'i'));
      const qty = qMatch ? parseFloat(qMatch[1].replace(',', '.')) : 1;
      const kcal = Math.round(row.kcal * qty);
      items.push({ name: m[0], qty, unit: row.unit, kcal });
      total += kcal;
    }
  }

  const tip = total > 0
    ? 'Dica: acrescente proteínas magras e vegetais para melhor saciedade.'
    : 'Não identifiquei alimentos. Escreva algo como: "2 ovos, 1 pão, café".';

  return { items, total, tip };
}

// ==== Webhook (padrão WhatsApp/360) ====
app.post('/webhook', async (req, res) => {
  console.log('🟦 Webhook recebido');
  res.sendStatus(200); // responde rápido ao 360

  try {
    const entry = req.body?.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const msg = value?.messages?.[0];
    const from = msg?.from;

    if (!msg || !from) {
      console.log('ℹ️ Evento sem mensagem/contato útil');
      return;
    }

    if (msg.type === 'text') {
      const text = msg.text?.body || '';
      const { items, total, tip } = estimateCalories(text);
      const lines = items.length
        ? items.map(i => `• ${i.name}: ${i.qty} × ${i.unit} ≈ ${i.kcal} kcal`).join('\n')
        : '• (nada identificado)';

      const body =
        `Itens:\n${lines}\n\n⚖️ Total estimado: ${total} kcal\n💡 ${tip}`;

      await sendText360(from, body);
      return;
    }

    // Imagem ainda não: responder orientando
    if (msg.type === 'image') {
      await sendText360(from, 'Recebi a foto! Nesta versão estou calculando só por texto. Envie a descrição do prato (ex.: "120 g frango, 100 g arroz, salada").');
      return;
    }

    // Outros tipos
    await sendText360(from, 'Me envie sua refeição em texto que eu somo as calorias. 📋');
  } catch (err) {
    console.error('🔥 Erro no webhook:', err?.response?.data || err.message);
  }
});

// Healthcheck
app.get('/', (_req, res) => res.send('Kali Nutro IA (360) OK'));
app.listen
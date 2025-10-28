// index.js — versão corrigida e funcional com OpenAI

import express from 'express';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;
const D360_API_KEY = process.env.D360_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Validações iniciais
if (!D360_API_KEY) {
  console.warn('⚠️ D360_API_KEY não configurado — defina no Railway / Variables');
}
if (!OPENAI_API_KEY) {
  console.warn('⚠️ OPENAI_API_KEY não configurado — defina no Railway / Variables');
}

/**
 * Envia texto via 360dialog v2
 */
async function sendText(to, body) {
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: String(to),
    type: 'text',
    text: { body: String(body) }
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

    const respText = await resp.text();
    console.log(`➡️ 360 status: ${resp.status} body: ${respText}`);
    return { status: resp.status, body: respText };
  } catch (err) {
    console.error('❌ Erro ao chamar 360dialog:', err);
    throw err;
  }
}

/**
 * Health check
 */
app.get('/', (req, res) => {
  res.send('✅ Kali Nutro IA com OpenAI estável rodando');
});

/**
 * Webhook (recebe mensagens do WhatsApp)
 */
app.post('/webhook', async (req, res) => {
  try {
    console.log('🟦 Webhook recebido');
    console.log('↩️ body:', JSON.stringify(req.body));

    // Responde rápido ao 360
    res.status(200).send('OK');

    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const messages = value?.messages;

    if (!messages || !Array.isArray(messages)) {
      console.log('⚠️ Nenhuma mensagem processável encontrada.');
      return;
    }

    for (const msg of messages) {
      const from = msg.from;
      const type = msg.type;

      console.log(`💬 de ${from}: tipo=${type}`);

      if (type === 'text' && msg.text?.body) {
        const received = msg.text.body;
        console.log(`📥 recebido: ${received}`);

        // Resposta com OpenAI para informações nutricionais usando proxy
        try {
          const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${OPENAI_API_KEY}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              model: 'gpt-4-turbo',
              messages: [
                {
                  role: 'system',
                  content: 'Você é um nutricionista especializado. Forneça informações precisas sobre calorias, macronutrientes e benefícios nutricionais de alimentos comuns no Brasil. Responda em português com até 80 palavras e inclua valor calórico quando possível. Assine como "Dr. Henrique Vuicik - CRM-PR 28088".'
                },
                {
                  role: 'user',
                  content: `Quantas calorias tem ${received}? Quais são seus principais nutrientes?`
                }
              ],
              temperature: 0.5,
              max_tokens: 200
            })
          });

          const data = await openaiResponse.json();
          
          if (data.choices && data.choices.length > 0) {
            const aiResponse = data.choices[0].message.content;
            await sendText(from, aiResponse);
          } else {
            await sendText(from, 'Desculpe, não consegui obter as informações nutricionais no momento.');
          }
        } catch (openaiError) {
          console.error("Erro OpenAI:", openaiError);
          await sendText(from, "Desculpe, não consegui obter as informações nutricionais no momento. Tente novamente em instantes.");
        }
      } else {
        await sendText(from, 'Recebi sua mensagem. Obrigado! 🙏');
      }
    }
  } catch (err) {
    console.error('🔥 Erro no /webhook:', err);
    try { res.status(500).send('erro'); } catch {}
  }
});

/**
 * Envio manual via POST /send
 */
app.post('/send', async (req, res) => {
  const { to, body } = req.body || {};
  if (!to || !body) return res.status(400).json({ error: 'to e body obrigatórios' });

  try {
    const resp = await sendText(to, body);
    res.json(resp);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Kali Nutro IA com OpenAI estável rodando na porta ${PORT}`);
  console.log(`🔔 Endpoint 360: https://waba-v2.360dialog.io/messages`);
  console.log(`🧠 OpenAI integrada via API direta`);
});

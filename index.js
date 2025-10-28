// index.js — Kali Nutro IA (estável com 360 v2 + OpenAI atual)

import express from 'express';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;
const D360_API_KEY = process.env.D360_API_KEY?.trim();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY?.trim();

if (!D360_API_KEY) console.warn('⚠️ D360_API_KEY não configurado — defina no Railway / Variables');
if (!OPENAI_API_KEY) console.warn('⚠️ OPENAI_API_KEY não configurado — defina no Railway / Variables');

/** Util: loga e retorna corpo puro da resposta */
async function readBody(resp) {
  const text = await resp.text();
  console.log(`➡️ 360 status: ${resp.status} body: ${text}`);
  return text;
}

/** Envia texto via 360dialog v2 */
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
    const raw = await readBody(resp);
    if (!resp.ok) {
      // Se acusar "messaging_product is required", mostre o payload no log.
      console.error('📦 Payload enviado à 360:', JSON.stringify(payload));
    }
    return { status: resp.status, body: raw };
  } catch (err) {
    console.error('❌ Erro ao chamar 360dialog:', err);
    return { error: String(err) };
  }
}

/** Health check */
app.get('/', (_req, res) => {
  res.send('✅ Kali Nutro IA com OpenAI estável rodando');
});

/** Webhook (recebe mensagens do WhatsApp) */
app.post('/webhook', async (req, res) => {
  try {
    console.log('🟦 Webhook recebido');
    console.log('↩️ body:', JSON.stringify(req.body));
    res.status(200).send('OK'); // responde rápido

    const msg = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!msg) {
      console.log('⚠️ Nenhuma mensagem processável encontrada.');
      return;
    }

    const from = msg.from;
    const type = msg.type;
    console.log(`💬 de ${from}: tipo=${type}`);

    if (type === 'text' && msg.text?.body) {
      const userText = msg.text.body;
      console.log(`📥 recebido: ${userText}`);

      // -------- OpenAI (chat.completions) --------
      try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [
              {
                role: 'system',
                content:
                  'Você é um nutricionista especializado. Forneça informações precisas sobre calorias e nutrientes em alimentos comuns no Brasil. Responda em português com até 80 palavras. Assine como "Dr. Henrique Vuicik - CRM-PR 28088".'
              },
              {
                role: 'user',
                content: `Quantas calorias tem ${userText}? Quais são seus principais nutrientes?`
              }
            ],
            temperature: 0.5,
            max_tokens: 220
          })
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error('❌ Erro OpenAI:', response.status, errorText);
          await sendText(from, 'Desculpe, houve um erro ao consultar a IA. Verifique a chave e o uso da OpenAI.');
          return;
        }

        const data = await response.json();
        const aiResponse = data?.choices?.[0]?.message?.content?.trim();

        if (aiResponse) {
          await sendText(from, aiResponse);
        } else {
          await sendText(from, 'Não consegui obter os dados desse alimento. Tente especificar: ex. "100g de arroz cozido".');
        }
      } catch (openaiError) {
        console.error('💥 Erro fatal OpenAI:', openaiError);
        if (!OPENAI_API_KEY) {
          await sendText(from, 'Erro: OPENAI_API_KEY não configurada no Railway.');
        } else if (OPENAI_API_KEY.length < 10) {
          await sendText(from, 'Erro: OPENAI_API_KEY parece inválida. Verifique no Railway.');
        } else {
          await sendText(from, 'Sistema temporariamente indisponível. Tente novamente em instantes.');
        }
      }
      // -------------------------------------------
    } else {
      await sendText(from, 'Recebi sua mensagem. Obrigado! 🙏');
    }
  } catch (err) {
    console.error('🔥 Erro no /webhook:', err);
    try { res.status(500).send('erro'); } catch {}
  }
});

/** Envio manual */
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
});
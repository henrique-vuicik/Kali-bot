// index.js — versão corrigida e funcional com OpenAI

import express from 'express';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;
const D360_API_KEY = process.env.D360_API_KEY?.trim();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY?.trim();

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
    return { error: err.message };
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

        // Primeira tentativa de resposta com OpenAI
        try {
          const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${OPENAI_API_KEY}`,
              'Content-Type': 'application/json',
              'OpenAI-Version': '2023-07-01'
            },
            body: JSON.stringify({
              model: 'gpt-3.5-turbo',
              messages: [
                {
                  role: 'system',
                  content: 'Você é um nutricionista especializado. Forneça informações precisas sobre calorias e nutrientes em alimentos comuns no Brasil. Responda em português com até 80 palavras. Assine como "Dr. Henrique Vuicik - CRM-PR 28088".'
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

          if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ Erro OpenAI:', response.status, errorText);
            
            // Mensagem de erro direcionada
            await sendText(from, 'Desculpe, a OpenAI retornou erro. Verifique sua chave API e limite de uso.');
            return;
          }

          const data = await response.json();
          
          if (data.choices && data.choices.length > 0) {
            const aiResponse = data.choices[0].message.content;
            await sendText(from, aiResponse);
          } else {
            await sendText(from, 'Não consegui obter informações detalhadas sobre este alimento. Tente especificar melhor (ex: "100g de arroz cozido").');
          }
        } catch (openaiError) {
          console.error("💥 Erro fatal OpenAI:", openaiError);
          
          // Tentativa de diagnóstico da chave API
          if (OPENAI_API_KEY && OPENAI_API_KEY.length < 10) {
            await sendText(from, 'Erro: Chave API da OpenAI parece estar incorreta. Verifique no Railway.');
          } else if (!OPENAI_API_KEY) {
            await sendText(from, 'Erro: Chave API da OpenAI não configurada. Configure no Railway.');
          } else {
            await sendText(from, 'Sistema temporariamente indisponível. Tente novamente em instantes.');
          }
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
  console.log(`🔑 Chave OpenAI configurada: ${!!OPENAI_API_KEY}`);
  console.log(`🧠 Sistema de nutrição ativo`);
});

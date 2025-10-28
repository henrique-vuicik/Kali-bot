// index.js — Kali em modo conversa livre (nutrição, treino e medicações), tom leve e objetivo

import express from 'express';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;
const D360_API_KEY = process.env.D360_API_KEY?.trim();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY?.trim();
const OPENAI_MODEL = process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini'; // permite trocar o modelo por variável

// Avisos de variáveis
if (!D360_API_KEY) console.warn('⚠️ D360_API_KEY não configurado — defina no Railway / Variables');
if (!OPENAI_API_KEY) console.warn('⚠️ OPENAI_API_KEY não configurado — defina no Railway / Variables');

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
    const respText = await resp.text();
    console.log(`➡️  360 status: ${resp.status} body: ${respText}`);
    return { status: resp.status, body: respText };
  } catch (err) {
    console.error('❌ Erro ao chamar 360dialog:', err);
    return { error: err.message };
  }
}

/** Health check */
app.get('/', (req, res) => {
  res.send('✅ Kali Nutro IA estável rodando (conversa livre)');
});

/** Webhook (recebe mensagens do WhatsApp) */
app.post('/webhook', async (req, res) => {
  try {
    console.log('🟦 Webhook recebido');
    console.log('↩️ body:', JSON.stringify(req.body));
    // responde rápido ao 360
    res.status(200).send('OK');

    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const messages = value?.messages;

    if (!Array.isArray(messages) || messages.length === 0) {
      console.log('⚠️ Nenhuma mensagem processável encontrada.');
      return;
    }

    for (const msg of messages) {
      const from = msg.from;
      const type = msg.type;
      console.log(`💬 de ${from}: tipo=${type}`);

      // Apenas texto por enquanto
      if (type === 'text' && msg.text?.body) {
        const userText = String(msg.text.body || '').trim();
        console.log(`📥 recebido: ${userText}`);

        // Respostas curtinhas para saudações simples (economiza tokens e é mais ágil)
        const t = userText.toLowerCase();
        if (['oi','olá','ola','bom dia','boa tarde','boa noite'].some(s => t.startsWith(s))) {
          await sendText(from, 'Oi! Sou a Kali. Pode mandar dúvidas de nutrição, treino ou medicações 😉');
          continue;
        }

        // Chamada à OpenAI — conversa livre
        try {
          const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${OPENAI_API_KEY}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              model: OPENAI_MODEL,
              messages: [
                {
                  role: 'system',
                  content: `
Você é a **Kali**, assistente de nutrição e saúde do consultório.
Estilo: WhatsApp — simples, breve, amigável, sem formalidade e **sem assinatura**.
Objetivo: responder dúvidas sobre alimentação, calorias, composição nutricional, estratégias de treino,
rotina de exercícios, sono, hidratação e também medicações/fitoterápicos relacionados à saúde e peso.
Diretrizes:
- Seja objetiva (2–5 frases curtas). Se a dúvida pedir números, dê faixas típicas e exemplos práticos.
- Evite jargões; explique em linguagem comum. Pode usar emojis com moderação (😉, ✅, ⚠️, 🍽️, 🏋️).
- Não faça diagnóstico nem prescrição. Em temas de medicação, traga informações gerais (mecanismo, efeitos comuns,
  riscos, interações frequentes) e **recomende avaliação médica** quando necessário.
- Quando o usuário citar um alimento, se possível traga kcal aproximada por porção comum e dicas de troca/porção.
- Se a pergunta for ampla, ofereça 2–3 caminhos práticos (ex.: “por onde começar”).
- Nunca assine como médico, não cite CRM, não use tom burocrático.
                `.trim()
                },
                { role: 'user', content: userText }
              ],
              temperature: 0.6,
              max_tokens: 260
            })
          });

          if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ Erro OpenAI:', response.status, errorText);
            await sendText(from, 'Tive um problema aqui com a IA. Pode tentar de novo em instantes? 🙏');
            continue;
          }

          const data = await response.json();
          const aiMsg = data?.choices?.[0]?.message?.content?.trim();

          if (aiMsg) {
            await sendText(from, aiMsg);
          } else {
            await sendText(from, 'Não consegui entender bem. Pode reformular em uma frase? 😊');
          }
        } catch (openaiError) {
          console.error('💥 Erro fatal OpenAI:', openaiError);
          if (!OPENAI_API_KEY) {
            await sendText(from, 'Erro: chave da IA não configurada. (admin) Verifique OPENAI_API_KEY no Railway.');
          } else {
            await sendText(from, 'Deu uma oscilação aqui. Tenta novamente já já, por favor 🙏');
          }
        }
      } else {
        // Tipos não-texto
        await sendText(from, 'Recebi! Se puder, me manda em texto o que você precisa 😉');
      }
    }
  } catch (err) {
    console.error('🔥 Erro no /webhook:', err);
    try { res.status(500).send('erro'); } catch {}
  }
});

/** Envio manual via POST /send (teste rápido) */
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
  console.log(`🚀 Kali Nutro IA estável rodando na porta ${PORT}`);
  console.log(`🔔 Endpoint 360: https://waba-v2.360dialog.io/messages`);
  console.log(`🧠 Modelo OpenAI: ${OPENAI_MODEL}`);
});
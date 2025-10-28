// index.js — versão estável com integração de IA (brain.js)
import express from 'express';
import dotenv from 'dotenv';
import process from 'process';
import { aiReply, quickIntent, chunkText } from './brain.js';

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;
const D360_API_KEY = process.env.D360_API_KEY;

if (!D360_API_KEY) {
  console.warn('⚠️ D360_API_KEY não configurado — configure no Railway / env vars');
}

/**
 * Envia mensagem de texto via 360dialog API v2
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
    const resp = await fetch('https://waba-v2.360dialog.io/v1/messages', {
      method: 'POST',
      headers: {
        'D360-API-KEY': D360_API_KEY,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const respText = await resp.text();
    console.log(`➡️  360 status: ${resp.status} body: ${respText}`);
    return { status: resp.status, body: respText };
  } catch (err) {
    console.error('❌ Erro ao enviar mensagem 360dialog:', err);
    throw err;
  }
}

/**
 * Health Check
 */
app.get('/', (req, res) => {
  res.send('✅ Kali Nutro IA estável e operante.');
});

/**
 * Webhook — recebe mensagens do WhatsApp
 */
app.post('/webhook', async (req, res) => {
  try {
    console.log('🟦 Webhook recebido');
    console.log('↩️ body:', JSON.stringify(req.body));

    // Confirmação rápida para o 360dialog
    res.status(200).send('OK');

    const entry = req.body?.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const messages = value?.messages;

    if (!messages || !Array.isArray(messages)) {
      console.log('Nenhuma mensagem processável encontrada.');
      return;
    }

    for (const msg of messages) {
      try {
        const from = msg.from;
        const type = msg.type;
        console.log(`💬 de ${from}: tipo=${type}`);

        if (type === 'text' && msg.text?.body) {
          const received = msg.text.body;
          console.log(`📥 recebido: ${received}`);

          // Verifica se é um atalho rápido
          const shortcut = quickIntent(received);

          // Se não houver resposta programada, usa IA
          const reply = shortcut ?? await aiReply(from, received, value?.contacts?.[0]?.profile?.name);

          // Envia em blocos (se resposta for longa)
          for (const part of chunkText(reply)) {
            await sendText(from, part);
          }

        } else {
          await sendText(from, 'Recebi sua mensagem ✅');
        }

      } catch (innerErr) {
        console.error('Erro ao processar mensagem individual:', innerErr);
      }
    }

  } catch (err) {
    console.error('Erro no endpoint /webhook:', err);
    try { res.status(500).send('erro interno'); } catch {}
  }
});

/**
 * Endpoint manual para testes via POST
 * Ex: POST /send { "to": "55429...", "body": "Teste IA" }
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
  console.log(`🚀 Kali Nutro IA rodando na porta ${PORT}`);
  console.log(`🔔 Endpoint 360: https://waba-v2.360dialog.io/v1/messages`);
});
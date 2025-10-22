import express from "express";

const app = express();
app.use(express.json({ limit: '1mb' }));

// Configurações essenciais
const D360_API_KEY = process.env.D360_API_KEY?.trim();
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID?.trim();
const PORT = process.env.PORT || 8080;

// Log de inicialização
console.log("🔹 INICIANDO ASSISTENTE DE DIETA");
console.log("📱 Número ID:", PHONE_NUMBER_ID);
console.log("🔑 API Key configurada:", !!D360_API_KEY);

const log = (lvl, msg, extra) => {
  const tag = lvl === "err" ? "🟥" : lvl === "ok" ? "✅" : "🟦";
  console.log(`${tag} ${msg}`, extra ? JSON.stringify(extra) : "");
};

app.post("/webhook", async (req, res) => {
  try {
    // Extração segura da mensagem
    const from = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from;
    const text = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.text?.body;
    
    if (!from || !text) {
      return res.sendStatus(200);
    }

    // Normalização do número
    const numeroFormatado = from.toString().replace(/\D/g, '');
    
    // Log da mensagem recebida
    log("📥", `Mensagem recebida de ${numeroFormatado}: ${text}`);

    // Tentativa de envio com lógica simplificada
    const payload = {
      messaging_product: "whatsapp",
      to: numeroFormatado,
      type: "text",
      text: { 
        body: "🟢 ASSISTENTE DE DIETA ESTÁ FUNCIONANDO PERFEITAMENTE! Sua automação está completa." 
      }
    };

    const headers = {
      "Content-Type": "application/json",
      "D360-API-KEY": D360_API_KEY
    };

    const url = `https://waba-v2.360dialog.io/v1/${PHONE_NUMBER_ID}/messages`;

    // Envio direto (sem retentativas para diagnóstico)
    const response = await fetch(url, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(payload)
    });

    // Leitura da resposta
    const body = await response.text();

    if (!response.ok) {
      log("❌", `Erro ${response.status}`, { 
        body: body.substring(0, 200) 
      });
    } else {
      log("✅", "✔️ RESPOSTA ENVIADA COM SUCESSO!");
      log("🎉", "ASSISTENTE DE DIETA CONFIGURADO COM SUCESSO!");
    }

    res.sendStatus(200);

  } catch (error) {
    log("💥", "Erro", { message: error.message });
    res.sendStatus(200);
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Assistente funcionando na porta ${PORT}`);
  console.log("🎯 Sistema de automação de dieta via WhatsApp pronto");
});

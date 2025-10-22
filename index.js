import express from "express";

const app = express();
app.use(express.json());

// === CONFIGURAÇÃO PRINCIPAL ===
const D360_API_KEY = process.env.D360_API_KEY?.trim();
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID?.trim();
const PORT = process.env.PORT || 8080;

// === DIAGNÓSTICO DETALHADO ===
console.log("🔧 DIAGNÓSTICO DE CONFIGURAÇÃO:");
console.log("D360_API_KEY:", D360_API_KEY ? "✅ PRESENTE" : "❌ FALTANDO");
console.log("PHONE_NUMBER_ID:", PHONE_NUMBER_ID ? `✅ ${PHONE_NUMBER_ID}` : "❌ FALTANDO");
console.log("PORT:", PORT);
console.log("⏳ Iniciando servidor...");

const log = (lvl, msg, extra) => {
  const tag = lvl === "err" ? "🟥" : lvl === "ok" ? "✅" : "🟦";
  console.log(`${tag} ${msg}`, extra ? JSON.stringify(extra) : "");
};

// Rota de saúde
app.get("/", (req, res) => {
  res.json({
    status: "ativo",
    configuracao: {
      d360_api_key: !!D360_API_KEY,
      phone_number_id: !!PHONE_NUMBER_ID,
      phone_number_id_value: PHONE_NUMBER_ID
    },
    mensagem: "Se phone_number_id for null, verifique as variáveis de ambiente"
  });
});

app.post("/webhook", async (req, res) => {
  try {
    log("🟦", "Webhook recebido");

    // 1. EXTRAÇÃO DA MENSAGEM
    const entry = req.body?.entry?.[0];
    if (!entry) {
      log("err", "Sem entry", {});
      return res.sendStatus(200);
    }

    const changes = entry?.changes?.[0];
    if (!changes) {
      log("err", "Sem changes", { entry });
      return res.sendStatus(200);
    }

    const value = changes?.value;
    if (!value) {
      log("err", "Sem value", { changes });
      return res.sendStatus(200);
    }

    const messages = value?.messages?.[0];
    if (!messages) {
      log("err", "Sem messages", { value });
      return res.sendStatus(200);
    }

    // 2. VALIDAÇÃO DO TIPO DE MENSAGEM
    if (messages.type !== "text" || !messages.text?.body) {
      log("ok", "Não é mensagem de texto", { type: messages.type });
      return res.sendStatus(200);
    }

    // 3. EXTRAÇÃO DO NÚMERO E TEXTO
    const from = messages.from?.toString().trim();
    const text = messages.text.body?.trim();
    
    // 4. VALIDAÇÃO FINAL
    if (!from || !text) {
      log("err", "Faltando from ou text", { from, text });
      return res.sendStatus(200);
    }

    // 5. VALIDAÇÃO DO NÚMERO BRASILEIRO
    if (!from.startsWith("55") || from.length < 11 || from.length > 13) {
      log("err", "Número inválido", { from });
      return res.sendStatus(200);
    }

    log("✅", `Mensagem de ${from}: ${text}`);

    // === VERIFICAÇÃO CRÍTICA DO PHONE_NUMBER_ID ===
    if (!PHONE_NUMBER_ID) {
      console.log("❌ FATAL: PHONE_NUMBER_ID não está configurado!");
      console.log("📝 INSTRUÇÕES:");
      console.log("1. Acesse o Railway");
      console.log("2. Vá em 'Variables'");
      console.log("3. Adicione:");
      console.log("   Nome: PHONE_NUMBER_ID");
      console.log("   Valor: 884962384692953");
      console.log("4. Clique em 'Deploy'");
      return res.sendStatus(200);
    }

    // 6. URL DE API - ESTRUTURA CORRETA
    const url = `https://waba-v2.360dialog.io/v1/${PHONE_NUMBER_ID}/messages`;
    
    // 7. VALIDAÇÃO DA URL
    if (url.includes('undefined') || url.includes('null')) {
      log("❌", "URL inválida", { url });
      return res.sendStatus(200);
    }

    // 8. PAYLOAD DE RESPOSTA
    const payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: from,
      type: "text",
      text: { 
        body: "🟢 ASSISTENTE DE DIETA ESTÁ FUNCIONANDO! Como posso ajudar com sua alimentação?" 
      }
    };

    // 9. HEADERS DE AUTENTICAÇÃO
    const headers = {
      "Content-Type": "application/json",
      "D360-API-KEY": D360_API_KEY
    };

    // 10. LOG DE DIAGNÓSTICO
    console.log("📤 ENVIANDO RESPOSTA:");
    console.log("URL:", url);
    console.log("TO:", from);
    console.log("PAYLOAD:", JSON.stringify(payload));
    console.log("HEADERS:", JSON.stringify(headers));

    // 11. TENTATIVA DE ENVIO
    const response = await fetch(url, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(payload)
    });

    // 12. LEITURA DA RESPOSTA
    const body = await response.text();

    // 13. VERIFICAÇÃO DO STATUS
    if (!response.ok) {
      log("❌", `Erro ${response.status} ${response.statusText}`, { 
        status: response.status,
        body: body.substring(0, 300)
      });
      // Log de erro detalhado para diagnóstico
      console.log("📋 INSTRUÇÕES DE CORREÇÃO:");
      console.log("1. Verifique no Railway se PHONE_NUMBER_ID está configurado");
      console.log("2. O valor deve ser: 884962384692953");
      console.log("3. Sem espaços no início ou fim");
      console.log("4. Clique em 'Deploy' após alterar");
    } else {
      log("✅", "✔️ RESPOSTA ENVIADA COM SUCESSO!");
    }

    // 14. RESPOSTA AO WEBHOOK
    res.sendStatus(200);

  } catch (error) {
    log("💥", "Erro crítico", { 
      message: error.message,
      stack: error.stack?.split('\n')[1]?.trim()
    });
    res.sendStatus(200);
  }
});

// 15. INICIALIZAÇÃO DO SERVIDOR
app.listen(PORT, () => {
  console.log(`🚀 SERVIDOR INICIADO NA PORTA ${PORT}`);
  console.log("🎯 Pronto para receber mensagens...");
  console.log("💡 Para verificar configuração, acesse /");
});

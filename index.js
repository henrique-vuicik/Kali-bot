const express = require("express");
const axios   = require("axios");

// ===== ENV =====
const PORT          = process.env.PORT || 8080;
const D360_API_KEY  = process.env.D360_API_KEY;   // obrigatória
const TEST_TO       = process.env.TEST_TO || "554291251751"; // seu número

if (!D360_API_KEY) {
  console.error("❌ D360_API_KEY ausente. Configure no Railway.");
  process.exit(1);
}

const D360_URL = "https://waba-v2.360dialog.io/v1/messages";

// ——— Envio 360 com fallback de payload ———
async function send360(to, body) {
  const headers = { "Content-Type": "application/json", "D360-API-KEY": D360_API_KEY };

  // Versão A (mais aceita pelo 360)
  const A = { to, type: "text", text: { body, preview_url: false } };
  try {
    const r = await axios.post(D360_URL, A, { headers, timeout: 15000 });
    return r.data;
  } catch (e) {
    const status = e.response?.status;
    const data   = e.response?.data;
    console.warn("⚠️ Envio A falhou:", status, data);

    // Versão B (com recipient_type) — alguns workspaces exigem
    const B = { recipient_type: "individual", to, type: "text", text: { body, preview_url: false } };
    const r2 = await axios.post(D360_URL, B, { headers
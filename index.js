async function sendMessage(to, body) {
  const url = `${process.env.CLOUD_API_URL}/messages`;
  const payload = {
    to,
    type: "text",
    text: { body }
  };

  try {
    const response = await axios.post(url, payload, {
      headers: {
        "Content-Type": "application/json",
        "D360-API-KEY": process.env.CLOUD_API_TOKEN
      }
    });

    console.log("🟩 Mensagem enviada com sucesso!", response.data);
  } catch (error) {
    console.error("🟥 Erro ao enviar mensagem:", error.response?.data || error.message);
  }
}
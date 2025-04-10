require('dotenv').config();
const axios = require('axios');

async function runGemini() {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    const model = "models/gemini-1.5-pro";

    console.log("Using key:", "****" + apiKey.slice(-4));
    console.log("Using model:", model);

    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/${model}:generateContent`,
      {
        contents: [
          {
            parts: [{ text: "Tell me a fun fact about space." }]
          }
        ]
      },
      {
        headers: {
          'Content-Type': 'application/json',
        },
        params: {
          key: apiKey
        }
      }
    );

    const text = response.data.candidates[0].content.parts[0].text;
    console.log("✅ Response:", text);
  } catch (err) {
    console.error("❌ Error:", err.response?.data || err.message);
  }
}

runGemini();

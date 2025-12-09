// ai-service.js - SIMPLIFIED AND FIXED
const axios = require('axios');

console.log("Loading AI service...");

async function generateContent(prompt) {
  console.log(`AI Service called: ${prompt.substring(0, 100)}...`);
  
  try {
    const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
    
    if (!DEEPSEEK_API_KEY) {
      console.error("ERROR: DEEPSEEK_API_KEY is missing from .env file!");
      console.error("Please add: DEEPSEEK_API_KEY=your-key-here to .env file");
      throw new Error('DeepSeek API key is not configured. Check server logs.');
    }

    console.log("Making request to DeepSeek API...");
    
    const response = await axios.post(
      'https://api.deepseek.com/chat/completions',
      {
        model: 'deepseek-chat',
        messages: [
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: 1000,
        stream: false
      },
      {
        headers: {
          'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 45000
      }
    );

    console.log("DeepSeek response received successfully");
    return response.data.choices[0].message.content;
    
  } catch (error) {
    console.error("DeepSeek API Error:", error.message);
    
    if (error.response) {
      console.error("Response status:", error.response.status);
      console.error("Response data:", error.response.data);
    }

    return `Professional response (fallback): ${prompt.substring(0, 150)}... [Note: Check API key in .env file]`;
  }
}

console.log("AI service initialized");
module.exports = { generateContent };
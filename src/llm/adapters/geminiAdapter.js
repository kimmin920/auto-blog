import { GoogleGenAI } from "@google/genai";

const clients = new Map();

function getClient(apiKey) {
  const key = String(apiKey || "").trim();
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  if (!clients.has(key)) {
    clients.set(key, new GoogleGenAI({ apiKey: key }));
  }
  return clients.get(key);
}

export async function callGeminiAdapter({ providerConfig = {}, messages, jsonMode = true }) {
  const apiKey = providerConfig.apiKey || process.env.GEMINI_API_KEY;
  const model = String(providerConfig.model || process.env.GEMINI_MODEL || "gemini-2.5-flash").trim();
  const client = getClient(apiKey);

  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const userText = messages.filter((m) => m.role !== "system").map((m) => m.content).join("\n\n");

  const response = await client.models.generateContent({
    model,
    systemInstruction: system || undefined,
    contents: userText,
    config: {
      temperature: Number(providerConfig.temperature ?? 0.7),
      ...(jsonMode ? { responseMimeType: "application/json" } : {}),
    },
  });

  return {
    rawText: String(response?.text || "").trim(),
    model,
    provider: "gemini",
  };
}

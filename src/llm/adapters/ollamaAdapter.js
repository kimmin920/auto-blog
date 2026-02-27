import ollama from "ollama";

export async function callOllamaAdapter({ providerConfig = {}, messages, jsonMode = true }) {
  const model = String(providerConfig.model || process.env.OLLAMA_MODEL || "gpt-oss").trim();

  const response = await ollama.chat({
    model,
    messages,
    ...(jsonMode ? { format: "json" } : {}),
  });

  return {
    rawText: String(response?.message?.content || "").trim(),
    model,
    provider: "ollama",
  };
}

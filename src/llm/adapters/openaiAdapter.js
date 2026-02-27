import OpenAI from "openai";

const clients = new Map();

function getClient(apiKey) {
  const key = String(apiKey || "").trim();
  if (!key) throw new Error("OPENAI_API_KEY is not set");
  if (!clients.has(key)) {
    clients.set(key, new OpenAI({ apiKey: key }));
  }
  return clients.get(key);
}

function normalizeContent(content) {
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && typeof part.text === "string") return part.text;
        return "";
      })
      .join("\n")
      .trim();
  }
  return String(content || "").trim();
}

export async function callOpenaiAdapter({ providerConfig = {}, messages, jsonMode = true }) {
  const apiKey = providerConfig.apiKey || process.env.OPENAI_API_KEY || process.env.OPENAI_KEY || process.env.OPENAI_API_TOKEN;
  const model = String(providerConfig.model || process.env.OPENAI_MODEL || "gpt-4o-mini").trim();
  const client = getClient(apiKey);

  const isReasoningModel = model.includes("gpt-5") || model.includes("o1") || model.includes("o3");
  const request = { model, messages };

  if (!isReasoningModel) request.temperature = Number(providerConfig.temperature ?? 0.7);
  if (jsonMode && !isReasoningModel) request.response_format = { type: "json_object" };

  const completion = await client.chat.completions.create(request);
  return {
    rawText: normalizeContent(completion?.choices?.[0]?.message?.content),
    model,
    provider: "openai",
  };
}

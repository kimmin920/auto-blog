import OpenAI from "openai";

const clients = new Map();

function getClient(apiKey, accountId) {
  const key = String(apiKey || "").trim();
  const acct = String(accountId || "").trim();
  if (!key || !acct) throw new Error("CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID is not set");

  const cacheKey = `${acct}:${key.slice(0, 8)}`;
  if (!clients.has(cacheKey)) {
    clients.set(
      cacheKey,
      new OpenAI({
        apiKey: key,
        baseURL: `https://api.cloudflare.com/client/v4/accounts/${acct}/ai/v1`,
      })
    );
  }
  return clients.get(cacheKey);
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

export async function callCloudflareAdapter({ providerConfig = {}, messages, jsonMode = true }) {
  const apiKey = providerConfig.apiKey || process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN;
  const accountId = providerConfig.accountId || process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CF_ACCOUNT_ID;
  const model = String(providerConfig.model || process.env.CLOUDFLARE_MODEL || "@cf/meta/llama-3.1-8b-instruct").trim();
  const client = getClient(apiKey, accountId);

  const request = {
    model,
    messages,
    temperature: Number(providerConfig.temperature ?? 0.7),
  };

  let completion;
  if (jsonMode) {
    try {
      completion = await client.chat.completions.create({ ...request, response_format: { type: "json_object" } });
    } catch {
      completion = await client.chat.completions.create(request);
    }
  } else {
    completion = await client.chat.completions.create(request);
  }

  return {
    rawText: normalizeContent(completion?.choices?.[0]?.message?.content),
    model,
    provider: "cloudflare",
  };
}

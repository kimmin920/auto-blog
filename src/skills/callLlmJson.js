import { callOpenaiAdapter } from "../llm/adapters/openaiAdapter.js";
import { callGeminiAdapter } from "../llm/adapters/geminiAdapter.js";
import { callCloudflareAdapter } from "../llm/adapters/cloudflareAdapter.js";
import { callOllamaAdapter } from "../llm/adapters/ollamaAdapter.js";
import { callColabAdapter } from "../llm/adapters/colabAdapter.js";
import { parseJsonLike } from "../llm/parse/parseJsonLike.js";
import { repairJsonCompletion } from "../llm/parse/repairJsonCompletion.js";
import { validateAgainstSchema } from "../utils/schemaValidate.js";

function toProvider(providerConfig = {}) {
  const raw = String(providerConfig.provider || providerConfig.llmProvider || "openai").trim().toLowerCase();
  if (["openai", "gemini", "cloudflare", "ollama", "google-colab"].includes(raw)) return raw;
  return "openai";
}

async function invokeAdapter({ provider, providerConfig, messages, jsonMode }) {
  if (provider === "gemini") return callGeminiAdapter({ providerConfig, messages, jsonMode });
  if (provider === "cloudflare") return callCloudflareAdapter({ providerConfig, messages, jsonMode });
  if (provider === "ollama") return callOllamaAdapter({ providerConfig, messages, jsonMode });
  if (provider === "google-colab") return callColabAdapter({ providerConfig, messages, jsonMode });
  return callOpenaiAdapter({ providerConfig, messages, jsonMode });
}

function parseOrRepair(rawText, outputSchema) {
  const parsed = parseJsonLike(rawText);
  if (parsed) return parsed;
  return repairJsonCompletion(rawText, outputSchema);
}

function validateIfPossible(json, outputSchema, postValidate) {
  if (!json) return { ok: false, issues: ["JSON is null"] };

  const schemaResult = outputSchema ? validateAgainstSchema(json, outputSchema) : { ok: true, issues: [] };
  if (!schemaResult.ok) return schemaResult;

  if (typeof postValidate === "function") {
    const custom = postValidate(json);
    if (custom && custom.ok === false) {
      return {
        ok: false,
        issues: Array.isArray(custom.issues) ? custom.issues : ["Custom post validation failed"],
      };
    }
  }

  return { ok: true, issues: [] };
}

export async function callLlmJson({
  providerConfig = {},
  systemPrompt,
  userPromptJson,
  outputSchema = null,
  postValidate,
  additionalCorrective = "",
}) {
  const provider = toProvider(providerConfig);
  const userText =
    typeof userPromptJson === "string" ? userPromptJson : JSON.stringify(userPromptJson, null, 2);

  const messages = [
    { role: "system", content: String(systemPrompt || "") },
    { role: "user", content: userText },
  ];

  const first = await invokeAdapter({ provider, providerConfig, messages, jsonMode: true });
  const rawResponses = [
    {
      attempt: 1,
      provider,
      model: first.model,
      rawText: first.rawText,
    },
  ];
  const json = parseOrRepair(first.rawText, outputSchema);
  const validation = validateIfPossible(json, outputSchema, postValidate);

  if (!validation.ok) {
    const baseCorrective =
      "너의 이전 출력은 JSON 스키마를 만족하지 못했다. 설명/백틱 없이 output.schema를 만족하는 순수 JSON만 다시 출력하라.";
    const dynamicIssues = validation.issues.length ? `검증 실패 사유: ${validation.issues.join("; ")}` : "";
    const corrective = [baseCorrective, dynamicIssues, additionalCorrective].filter(Boolean).join("\n");

    const retryMessages = [
      { role: "system", content: String(systemPrompt || "") },
      { role: "user", content: `${userText}\n\n[추가 지시]\n${corrective}` },
    ];

    let second;
    try {
      second = await invokeAdapter({ provider, providerConfig, messages: retryMessages, jsonMode: true });
    } catch (error) {
      if (error && typeof error === "object") {
        error.llmResponses = rawResponses;
      }
      throw error;
    }
    rawResponses.push({
      attempt: 2,
      provider,
      model: second.model,
      rawText: second.rawText,
    });

    const retriedJson = parseOrRepair(second.rawText, outputSchema);
    const retriedValidation = validateIfPossible(retriedJson, outputSchema, postValidate);

    if (!retriedValidation.ok) {
      const error = new Error(`Model output is not valid JSON schema: ${retriedValidation.issues.join("; ")}`);
      error.llmResponses = rawResponses;
      throw error;
    }

    return {
      json: retriedJson,
      rawText: second.rawText,
      provider,
      model: second.model,
      rawResponses,
    };
  }

  return {
    json,
    rawText: first.rawText,
    provider,
    model: first.model,
    rawResponses,
  };
}

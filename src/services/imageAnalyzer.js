import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";
import { readFile } from "node:fs/promises";
import ollama from "ollama";

const clients = new Map();

function getGeminiCreds() {
  const apiKey = String(process.env.GEMINI_API_KEY || "").trim();
  const model = String(process.env.GEMINI_MODEL || "gemini-2.5-flash").trim();
  return { apiKey, model };
}

function getRuntime(provider, customGeminiModel, customOpenaiModel) {
  if (provider === "ollama") {
    return { ok: true, provider: "ollama", model: process.env.OLLAMA_VISION_MODEL || process.env.OLLAMA_MODEL || "llava", client: ollama };
  }
  if (provider === "gemini") {
    const creds = getGeminiCreds();
    if (customGeminiModel) {
      creds.model = customGeminiModel;
    }
    if (!creds.apiKey) return { ok: false, reason: "GEMINI_API_KEY is not set" };
    // cacheKey depends on model as well now
    const cacheKey = `gemini:${creds.apiKey.slice(0, 8)}:${creds.model}`;
    if (!clients.has(cacheKey)) clients.set(cacheKey, new GoogleGenAI({ apiKey: creds.apiKey }));
    return { ok: true, provider, model: creds.model, client: clients.get(cacheKey) };
  }

  if (provider === "cloudflare") {
    const apiKey = String(process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN || "").trim();
    const accountId = String(process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CF_ACCOUNT_ID || "").trim();
    const model = String(process.env.CLOUDFLARE_VISION_MODEL || "@cf/meta/llama-3.2-11b-vision-instruct").trim();

    if (!apiKey || !accountId) {
      return {
        ok: false,
        reason: "CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID is not set",
      };
    }

    return {
      ok: true,
      provider,
      model,
      apiKey,
      accountId,
    };
  }

  const apiKey = String(
    process.env.OPENAI_API_KEY || process.env.OPENAI_KEY || process.env.OPENAI_API_TOKEN || ""
  ).trim();
  let model = String(process.env.OPENAI_VISION_MODEL || "gpt-4o-mini").trim();
  if (customOpenaiModel) {
    model = customOpenaiModel;
  }

  if (!apiKey) {
    return {
      ok: false,
      reason: "OPENAI_API_KEY is not set",
    };
  }

  const key = `openai:${apiKey.slice(0, 8)}:${model}`;
  if (!clients.has(key)) {
    clients.set(key, new OpenAI({ apiKey }));
  }

  return {
    ok: true,
    provider: "openai",
    model,
    client: clients.get(key),
  };
}

function toDataUrl(buffer, mimeType) {
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

function buildPrompt(keywords, memo) {
  const parts = [];

  if (keywords || memo) {
    parts.push("이 이미지는 다음 블로그 포스팅을 위해 사용될 것입니다:");
    if (keywords) parts.push(`- 타겟 키워드: ${keywords}`);
    if (memo) parts.push(`- 작성자 메모/가이드: ${memo}`);
    parts.push("위 키워드와 메모의 내용을 참고하여 이미지를 분석하세요.");
    parts.push("");
  }

  parts.push(
    "이미지를 매우 자세히 분석해서 한국어로 작성해라.",
    "!!주의!! '다음은 이미지를 분석한 구조적인 설명입니다.'와 같은 인사말, 서술어, 부연 설명은 일절 포함하지 마라.",
    "오직 아래 형식의 결과만 출력해라:",
    "1) 한줄 요약: ...",
    "2) 장면/배경 디테일: ...",
    "3) 주요 피사체(사물/인물) 디테일: ...",
    "4) 색감/조명/구도: ...",
    "5) 이미지 안의 텍스트(OCR): ...",
    "6) 활용 가능한 블로그 문장 포인트 5개:",
    "7) 해시태그 후보 8개:"
  );

  return parts.join("\n");
}

function build403Hint(provider, model) {
  if (provider === "cloudflare") {
    return [
      "Cloudflare 403 점검:",
      "1) API Token 사용 여부 확인 (Global API Key 아님)",
      "2) Token 권한에 Workers AI Read(필요 시 Edit) 포함",
      "3) CLOUDFLARE_ACCOUNT_ID가 토큰 발급 계정과 동일",
      `4) 모델 접근 가능 여부 확인 (${model})`,
    ].join(" ");
  }

  return [
    "OpenAI 403 점검:",
    "1) OPENAI_API_KEY 유효성 확인",
    "2) 사용 모델 접근 권한/조직 설정 확인",
    "3) 결제/사용 한도 상태 확인",
  ].join(" ");
}

function extractErrorMeta(error) {
  const status = Number(error?.status || error?.response?.status || 0) || undefined;
  const requestId =
    String(
      error?.request_id ||
      error?.headers?.["x-request-id"] ||
      error?.response?.headers?.["x-request-id"] ||
      ""
    ).trim() || undefined;
  const apiMessage =
    String(
      error?.error?.message ||
      error?.response?.data?.error?.message ||
      error?.response?.error?.message ||
      ""
    ).trim() || undefined;

  return { status, requestId, apiMessage };
}

async function runCloudflareVision({ accountId, apiKey, model, prompt, image }) {
  const safeModel = String(model || "").trim();
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${safeModel}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt,
      image,
      temperature: 0.2,
      max_tokens: 1200,
    }),
  });

  const rawText = await response.text();
  let parsed = null;
  try {
    parsed = rawText ? JSON.parse(rawText) : null;
  } catch {
    parsed = null;
  }

  if (!response.ok) {
    const err = new Error(
      parsed?.errors?.[0]?.message || parsed?.error?.message || rawText || `HTTP ${response.status}`
    );
    err.status = response.status;
    throw err;
  }

  if (parsed?.success === false) {
    const err = new Error(parsed?.errors?.[0]?.message || "Workers AI request failed");
    err.status = Number(parsed?.errors?.[0]?.code || 0) === 7003 ? 400 : 422;
    throw err;
  }

  const output = parsed?.result;
  if (typeof output?.response === "string" && output.response.trim()) {
    return output.response.trim();
  }
  if (typeof output?.output_text === "string" && output.output_text.trim()) {
    return output.output_text.trim();
  }
  if (typeof output === "string" && output.trim()) {
    return output.trim();
  }
  if (Array.isArray(output) && output.length) {
    const joined = output
      .map((item) => String(item?.text || item?.content || "").trim())
      .filter(Boolean)
      .join("\n")
      .trim();
    if (joined) return joined;
  }

  throw new Error("Empty analysis result");
}

export async function analyzeImageFile({ imagePath, mimeType, llmProvider = "openai", geminiModel, openaiModel, targetKeywords, memo, colabAddress }) {
  const provider = llmProvider === "cloudflare" ? "cloudflare" : llmProvider === "gemini" ? "gemini" : llmProvider === "google-colab" ? "google-colab" : llmProvider === "ollama" ? "ollama" : "openai";
  let runtime = null;
  if (provider !== "google-colab") {
    runtime = getRuntime(provider, geminiModel, openaiModel);
    if (!runtime.ok) {
      return {
        ok: false,
        reason: runtime.reason,
      };
    }
  } else {
    if (!colabAddress) {
      return { ok: false, reason: "Colab Address is missing" }
    }
    runtime = { model: "google-colab" };
  }

  const buf = await readFile(imagePath);
  const dataUrl = toDataUrl(buf, mimeType || "image/jpeg");

  const promptText = buildPrompt(targetKeywords, memo);
  const prompt = [
    "너는 이미지를 분석해 구조적인 설명을 잘 만드는 비전 분석가다.",
    promptText,
  ].join("\n\n");

  try {
    let text = "";
    if (provider === "google-colab") {
      let endpoint = colabAddress.trim();
      if (!endpoint.endsWith('/generate')) {
        endpoint = endpoint.replace(/\/+$/, '') + '/generate';
      }

      const colabRes = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          prompt: prompt,
          max_new_tokens: 1500,
          temperature: 0.8
        })
      });
      if (!colabRes.ok) throw new Error("Colab endpoint failed: " + colabRes.statusText);
      const resText = await colabRes.text();
      try {
        const json = JSON.parse(resText);
        text = json.response || json.text || resText;
      } catch (e) {
        text = resText;
      }
    } else if (provider === "cloudflare") {
      text = await runCloudflareVision({
        accountId: runtime.accountId,
        apiKey: runtime.apiKey,
        model: runtime.model,
        prompt,
        image: dataUrl,
      });
    } else if (provider === "gemini") {
      const response = await runtime.client.models.generateContent({
        model: runtime.model,
        contents: [
          prompt,
          {
            inlineData: {
              data: buf.toString("base64"),
              mimeType: mimeType || "image/jpeg"
            }
          }
        ],
        config: {
          temperature: 0.2,
        },
      });
      text = response.text || "";
    } else if (provider === "ollama") {
      try {
        const response = await runtime.client.chat({
          model: runtime.model,
          messages: [
            {
              role: "system",
              content: "너는 이미지를 분석해 구조적인 설명을 잘 만드는 비전 분석가다.",
            },
            {
              role: "user",
              content: promptText,
              images: [buf.toString("base64")],
            },
          ],
        });
        text = response.message.content || "";
      } catch (e) {
        if (e.message && e.message.includes("fetch failed")) {
          throw new Error(`Ollama 서버 연결 실패 (fetch failed). 백그라운드에 Ollama 앱이 실행 중인지 확인하세요. 비전 모델명: ${runtime.model}`);
        }
        throw e;
      }
    } else {
      const isReasoningModel = runtime.model.includes("gpt-5") || runtime.model.includes("o1") || runtime.model.includes("o3");
      const reqConfig = {
        model: runtime.model,
        messages: [
          {
            role: "system",
            content: "너는 이미지를 분석해 구조적인 설명을 잘 만드는 비전 분석가다.",
          },
          {
            role: "user",
            content: [
              { type: "text", text: promptText },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
      };

      if (!isReasoningModel) {
        reqConfig.temperature = 0.2;
      }

      text = String(
        (await runtime.client.chat.completions.create(reqConfig)).choices?.[0]?.message?.content || ""
      ).trim();
    }

    if (!text) {
      return {
        ok: false,
        reason: "Empty analysis result",
      };
    }

    return {
      ok: true,
      provider,
      model: runtime.model,
      analysisText: text,
      promptText: prompt,
    };
  } catch (error) {
    const { status, requestId, apiMessage } = extractErrorMeta(error);
    const rawMessage = error instanceof Error ? error.message : "Unknown vision model error";
    const baseMessage = [rawMessage, apiMessage].filter(Boolean).join(" | ");
    const hint403 = status === 403 || /403/.test(baseMessage);
    const requestIdSuffix = requestId ? ` | request_id=${requestId}` : "";
    const hint = hint403 ? ` | ${build403Hint(provider, runtime.model)}` : "";

    return {
      ok: false,
      provider,
      model: runtime.model,
      statusCode: status,
      reason: `${baseMessage || "Vision model request failed"}${hint}${requestIdSuffix}`,
    };
  }
}

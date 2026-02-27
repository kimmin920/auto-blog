import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";
import { buildDraftOutput } from "./draftGenerator.js";
import ollama from 'ollama';
import { runWriterPipeline } from "./writerService.js";

const clients = new Map();

function getOpenAICreds() {
  const apiKey =
    process.env.OPENAI_API_KEY ||
    process.env.OPENAI_KEY ||
    process.env.OPENAI_API_TOKEN ||
    "";

  return {
    apiKey: String(apiKey).trim(),
    model: String(process.env.OPENAI_MODEL || "gpt-4o-mini").trim(),
  };
}

function getCloudflareCreds() {
  const apiKey = String(process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN || "").trim();
  const accountId = String(process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CF_ACCOUNT_ID || "").trim();
  const model = String(process.env.CLOUDFLARE_MODEL || "@cf/meta/llama-3.1-8b-instruct").trim();

  return {
    apiKey,
    accountId,
    model,
  };
}

function getGeminiCreds() {
  const apiKey = String(process.env.GEMINI_API_KEY || "").trim();
  const model = String(process.env.GEMINI_MODEL || "gemini-2.5-flash").trim();

  return {
    apiKey,
    model,
  };
}

function buildClient(provider, customGeminiModel, customOpenaiModel) {
  if (provider === "google-colab") {
    return { ok: true, provider: "google-colab", model: "google-colab", client: null };
  }
  if (provider === "ollama") {
    return { ok: true, provider: "ollama", model: process.env.OLLAMA_MODEL || "gpt-oss", client: ollama };
  }
  if (provider === "gemini") {
    const creds = getGeminiCreds();
    if (customGeminiModel) {
      creds.model = customGeminiModel;
    }
    if (!creds.apiKey) {
      return { ok: false, reason: "GEMINI_API_KEY is not set" };
    }

    const cacheKey = `gemini:${creds.apiKey.slice(0, 8)}:${creds.model}`;
    if (!clients.has(cacheKey)) {
      clients.set(
        cacheKey,
        new GoogleGenAI({ apiKey: creds.apiKey })
      );
    }
    return {
      ok: true,
      provider: "gemini",
      model: creds.model,
      client: clients.get(cacheKey),
    };
  }

  if (provider === "cloudflare") {
    const creds = getCloudflareCreds();
    if (!creds.apiKey || !creds.accountId) {
      return {
        ok: false,
        reason: "CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID is not set",
      };
    }

    const cacheKey = `cf:${creds.accountId}:${creds.apiKey.slice(0, 8)}`;
    if (!clients.has(cacheKey)) {
      clients.set(
        cacheKey,
        new OpenAI({
          apiKey: creds.apiKey,
          baseURL: `https://api.cloudflare.com/client/v4/accounts/${creds.accountId}/ai/v1`,
        })
      );
    }

    return {
      ok: true,
      provider,
      model: creds.model,
      client: clients.get(cacheKey),
    };
  }

  const creds = getOpenAICreds();
  if (customOpenaiModel) {
    creds.model = customOpenaiModel;
  }
  if (!creds.apiKey) {
    return {
      ok: false,
      reason: "OPENAI_API_KEY is not set",
    };
  }

  const cacheKey = `openai:${creds.apiKey.slice(0, 8)}:${creds.model}`;
  if (!clients.has(cacheKey)) {
    clients.set(cacheKey, new OpenAI({ apiKey: creds.apiKey }));
  }

  return {
    ok: true,
    provider: "openai",
    model: creds.model,
    client: clients.get(cacheKey),
  };
}

function normalizeHashtags(input, fallback) {
  if (!Array.isArray(input) || !input.length) return fallback;

  const normalized = input
    .map((tag) => String(tag).trim())
    .filter(Boolean)
    .map((tag) => (tag.startsWith("#") ? tag : `#${tag.replace(/\s+/g, "")}`));

  return normalized.length ? [...new Set(normalized)] : fallback;
}

function stripSocialNoise(text) {
  const lines = String(text || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim());

  const filtered = [];
  for (const line of lines) {
    if (!line) {
      if (filtered[filtered.length - 1] !== "") filtered.push("");
      continue;
    }
    if (/\blikes?\b.*\bcomments?\b/i.test(line)) continue;
    if (/^https?:\/\/\S+$/i.test(line)) continue;
    if (/^\{.*"title"\s*:\s*".*"body"\s*:/i.test(line)) continue;
    filtered.push(line);
  }

  const deduped = [];
  for (const line of filtered) {
    if (deduped[deduped.length - 1] === line) continue;
    deduped.push(line);
  }

  return deduped.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function sanitizeTitle(title, fallback) {
  const cleaned = String(title || "")
    .replace(/#[\p{L}\p{N}_-]+/gu, "")
    .replace(/["{}[\]]/g, "")
    .trim();
  const out = cleaned || fallback;
  return out.length > 80 ? `${out.slice(0, 80).trim()}...` : out;
}

function normalizeGeneratedDraft(parsed, baseDraft) {
  const title = sanitizeTitle(parsed?.title, baseDraft.title);
  const body = stripSocialNoise(parsed?.body || "");
  const hashtags = normalizeHashtags(parsed?.hashtags, baseDraft.hashtags);

  const invalidBodyTest = /"title"\s*:|"body"\s*:|^\{|\}$/im.test(body);
  const tooShort = body.length < 50;

  const invalidBody = !body || tooShort || invalidBodyTest;

  if (invalidBody) {
    const reason = !body ? "Empty body" : tooShort ? `Body too short (${body.length} chars)` : "Body contains JSON artifacts like 'title:' or '{'";
    return {
      title: baseDraft.title,
      body: baseDraft.body,
      hashtags: baseDraft.hashtags,
      degradedToBase: true,
      reason,
      rawBody: body // for debugging
    };
  }

  return {
    title,
    body,
    hashtags,
    degradedToBase: false,
  };
}

function stylePrompt(profile) {
  if (!profile) {
    return "스타일 프로필 없음. 일반적인 친절한 한국어 블로그 문체로 작성.";
  }

  if (profile.llmStyle?.stylePrompt) {
    return profile.llmStyle.stylePrompt;
  }

  const sampleText = (profile.writingSamples || [])
    .map((sample, idx) => `${idx + 1}) ${sample}`)
    .join("\n");

  return [
    `톤: ${profile.tone}`,
    `문장 평균 길이: ${profile.avgSentenceLength}`,
    `포스트 평균 길이: ${profile.avgPostWordCount || 0}`,
    `문장 종결 요(%) 비율: ${Math.round((profile.endingYoRatio || 0) * 100)}`,
    `이모지 빈도(1000단어당): ${profile.emojiPer1000Words}`,
    `단락 패턴: 도입 ${profile.paragraphPattern?.introParagraphs || 1}, 전개 ${profile.paragraphPattern?.bodyParagraphs || 3}, 요약 ${profile.paragraphPattern?.summaryParagraphs || 1}`,
    `소제목 수(평균): ${profile.paragraphPattern?.avgHeadingCount || 4}`,
    "참고 문체 샘플:",
    sampleText || "샘플 없음",
  ].join("\n");
}

function fewShotStyleExamples(profile) {
  const samples = Array.isArray(profile?.writingSamples) ? profile.writingSamples : [];
  if (!samples.length) return "샘플 없음";

  return samples
    .slice(0, 3)
    .map((sample, idx) => `예시 ${idx + 1}\n${sample}`)
    .join("\n\n");
}

function buildMessages({ styleProfile, sourceSummary, baseDraft }) {
  const pattern = styleProfile?.paragraphPattern || {};
  const safeIntro = Math.max(1, Math.min(3, Number(pattern.introParagraphs || 1)));
  const safeBody = Math.max(2, Math.min(8, Number(pattern.bodyParagraphs || 3)));
  const safeSummary = Math.max(1, Math.min(3, Number(pattern.summaryParagraphs || 1)));
  const safeHeadingTarget = Math.max(3, Math.min(8, Number(pattern.avgHeadingCount || 4)));
  const targetWords = Number(
    pattern.recommendedWordCount || styleProfile?.avgPostWordCount || baseDraft?.targetWordCount || 900
  );
  const minWords = Math.max(450, Math.round(targetWords * 0.85));
  const maxWords = Math.min(2600, Math.round(targetWords * 1.15));
  const introParagraphs = safeIntro;
  const bodyParagraphs = safeBody;
  const summaryParagraphs = safeSummary;
  const headingTarget = safeHeadingTarget;
  const personaSummary = String(styleProfile?.llmStyle?.personaSummary || "").trim();
  const styleRules = Array.isArray(styleProfile?.llmStyle?.styleRules)
    ? styleProfile.llmStyle.styleRules.map((x) => String(x).trim()).filter(Boolean)
    : [];
  const noTopicTerms = Array.isArray(styleProfile?.llmStyle?.doNotImitateTopics)
    ? styleProfile.llmStyle.doNotImitateTopics.map((x) => String(x).trim()).filter(Boolean)
    : [];

  const system = [
    "너는 사용자의 기존 블로그 문체를 최대한 보존해서, 주어진 짧은 메모나 소셜 미디어 피드를 바탕으로 '풍성하고 매끄러운 형태의 블로그 포스트'를 새롭게 작성해주는 전문 블로그 에디터다.",
    "원본 소스가 극단적으로 짧더라도(예: 한 줄짜리 인스타글), 당시의 상황, 기분, 디테일을 자연스럽게 상상하고 덧붙여서 최소 300~500 단어 이상의 풍성한 에세이나 후기형 블로그 글로 확장해라.",
    "문장은 기계적인 번역투나 딱딱한 요약이 아닌, 실제 사람이 쓴 후기형/경험담 블로그 톤으로 자연스럽게 연결한다.",
    "기계적인 템플릿 문장 반복, 과도한 나열식 bullet, 불필요한 FAQ/요약 강제를 피한다.",
    "출력은 반드시 JSON 객체 하나만 반환한다.",
    "SEO를 고려하되, 키워드만 억지로 반복하지 말고 독자가 진짜 읽기 편하고 공감할 수 있는 일상적인 흐름을 우선한다.",
  ].join(" ");

  const user = [
    "[스타일 프로필]",
    stylePrompt(styleProfile),
    "",
    "[문체 Few-shot 예시]",
    fewShotStyleExamples(styleProfile),
    "",
    "[작성자 페르소나(추정)]",
    personaSummary || "분석 정보 없음",
    "",
    "[문체 룰]",
    styleRules.length ? styleRules.map((x, i) => `${i + 1}. ${x}`).join("\n") : "룰 없음",
    "",
    "[문체가 아닌 반복 토픽 (강조 금지)]",
    noTopicTerms.length ? noTopicTerms.join(", ") : "없음",
    "",
    "[소셜 소스 요약]",
    sourceSummary || "소스 없음",
    "",
    "아래 JSON 스키마로만 반환하라. 절대로 다른 텍스트나 포맷(마크다운 문법 등)을 겉에 씌우지 마라:",
    '{"title":"블로그 제목","body":"블로그 본문 전체(마크다운 포함)","hashtags":["#태그1","#태그2"]}',
    "",
    "[블로그 작성 상세 가이드]",
    "1. 본문(body)은 블로그 글로 바로 발행할 수 있도록 작성해라. (너무 짧은 소셜 포스트라도 반드시 300~500단어 이상의 풍성한 에피소드로 상상해서 살을 붙여라)",
    "2. 제목은 검색 의도를 반영해 20~40자 내외로 매력적이게 작성해라.",
    "3. 도입부 훅(Hook): 본문 첫 시작은 가벼운 인사, 최근의 기분, 날씨 등 일상 이야기로 독자의 공감을 이끌어내라.",
    "4. 소셜 소스가 너무 짧더라도 절대 단순 요약체로 쓰지 마라. 인스타 사진의 느낌, 그 날의 감정, 구체적인 상황을 상상해서 덧붙여 완전한 하나로 만들어라.",
    "5. 연결어 사용: '그런데 말이죠-', '진짜 이러기 쉽지 않은데-', '이쯤 되면 궁금하시죠?' 등의 자연스러운 구어체 흐름을 넣어 끊기지 않게 해라.",
    "6. 문체 적극 반영: 사용자의 종결 어미 습관, 자주 쓰는 이모지 패턴, 문장 길이를 반드시 반영해라!",
    "7. 문단/구조 형식: 마크다운 소제목(##)을 3~4개 정도 센스있게 사용해서, 자연스럽게 이야기를 전개하라.",
    "8. 이미지 연출: 소스 요약에 제공된 미디어를 나열하지 말고 '저기 뒤에 보이는 것처럼~', '이 날 진짜 좋았던 게~' 처럼 문맥에 자연스럽게 녹여내라."
  ].join("\n");

  return {
    system,
    user,
  };
}

function normalizeMessages(messages) {
  if (Array.isArray(messages)) return messages;

  if (messages && typeof messages === "object") {
    const arr = [];
    if (messages.system) arr.push({ role: "system", content: String(messages.system) });
    if (messages.user) arr.push({ role: "user", content: String(messages.user) });
    return arr;
  }
  throw new Error("Invalid messages format");
}

function toSingleSystemAndUserText(msgArray) {
  const systemText = msgArray
    .filter(m => m.role === "system")
    .map(m => m.content)
    .join("\n\n")
    .trim();

  const userText = msgArray
    .filter(m => m.role !== "system")
    .map(m => m.content)
    .join("\n\n")
    .trim();

  return { systemText, userText };
}

async function callChatCompletion({ client, model, messages, provider, jsonMode = true, colabAddress }) {
  const msgArray = normalizeMessages(messages);
  const { systemText, userText } = toSingleSystemAndUserText(msgArray);

  if (provider === "ollama") {
    const response = await client.chat({
      model,
      messages: msgArray, // ✅ 이제 배열 그대로 가능
      format: jsonMode ? "json" : undefined,
    });
    return { choices: [{ message: { content: response.message.content } }] };
  }

  if (provider === "google-colab") {
    if (!colabAddress) throw new Error("Colab Address is missing");

    let endpoint = colabAddress.trim();
    if (!endpoint.endsWith("/generate")) endpoint = endpoint.replace(/\/+$/, "") + "/generate";

    const colabRes = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: `${systemText}\n\n${userText}`, // ✅ system+user 합친 텍스트
        max_new_tokens: 1500,
        temperature: 0.8,
      }),
    });

    if (!colabRes.ok) throw new Error("Colab endpoint failed: " + colabRes.statusText);

    const resText = await colabRes.text();
    let content = resText;
    try {
      const json = JSON.parse(resText);
      content = json.response || json.text || resText;
    } catch { }

    return { choices: [{ message: { content } }] };
  }

  if (provider === "gemini") {
    const promptParams = {
      systemInstruction: systemText || undefined,
      contents: userText, // ✅ user+corrective까지 합쳐짐
      config: { temperature: 0.7 },
    };
    if (jsonMode) promptParams.config.responseMimeType = "application/json";

    const response = await client.models.generateContent({ model, ...promptParams });
    return { choices: [{ message: { content: response.text } }] };
  }

  // OpenAI/호환
  const isReasoningModel = model.includes("gpt-5") || model.includes("o1") || model.includes("o3");
  const common = { model, messages: msgArray };

  if (!isReasoningModel) common.temperature = 0.7;

  if (!jsonMode || isReasoningModel) return client.chat.completions.create(common);

  return client.chat.completions.create({
    ...common,
    response_format: { type: "json_object" },
  });
}

function repairJsonCompletion(rawText) {
  try {
    const start = rawText.indexOf('{');
    const end = rawText.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(rawText.substring(start, end + 1));
    }
  } catch (e) {
    // Return null if repair fails
  }
  return null;
}

function parseCompletionJson(completion) {
  let text = "";
  if (completion?.choices?.[0]?.message?.content) {
    const raw = completion.choices[0].message.content;
    text = Array.isArray(raw)
      ? raw
        .map((part) => {
          if (typeof part === "string") return part;
          if (part && typeof part === "object" && typeof part.text === "string") return part.text;
          return "";
        })
        .join("\n")
        .trim()
      : String(raw || "{}").trim();
  } else if (typeof completion === "string") {
    text = completion;
  }

  try {
    return JSON.parse(text);
  } catch {
    const repaired = repairJsonCompletion(text);
    if (repaired) return repaired;

    // Some models wrap JSON with markdown code fences.
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenced?.[1]) {
      const inner = fenced[1].trim();
      try {
        return JSON.parse(inner);
      } catch {
        // continue to fallback extractor
      }
    }

    // Fallback: extract first balanced JSON object from mixed text.
    const start = text.indexOf("{");
    if (start >= 0) {
      let depth = 0;
      let inString = false;
      let escaped = false;

      for (let i = start; i < text.length; i += 1) {
        const ch = text[i];

        if (escaped) {
          escaped = false;
          continue;
        }

        if (ch === "\\\\") {
          escaped = true;
          continue;
        }

        if (ch === "\"") {
          inString = !inString;
          continue;
        }

        if (inString) continue;

        if (ch === "{") depth += 1;
        if (ch === "}") depth -= 1;

        if (depth === 0) {
          const candidate = text.slice(start, i + 1);
          try {
            return JSON.parse(candidate);
          } catch {
            break; // Fallback to regex extractor
          }
        }
      }
    }

    // Last fallback: convert free-form text to our schema.
    const unfenced = text
      .replace(/```(?:json)?/gi, "")
      .replace(/```/g, "")
      .trim();

    // Aggressively recover if LLM wrote bad JSON (e.g. unescaped multiline strings)
    const bodyMatch = unfenced.match(/"body"\s*:\s*"([\s\S]*?)"\s*,?\s*"hashtags"/i) ||
      unfenced.match(/"body"\s*:\s*"([\s\S]*?)"\s*\}/i);

    if (bodyMatch && unfenced.trim().startsWith("{")) {
      const titleMatch = unfenced.match(/"title"\s*:\s*"([^"]*)"/i);
      const title = titleMatch ? titleMatch[1].replace(/\\"/g, '"') : "자동 생성 블로그 글";
      const body = bodyMatch[1].replace(/\\n/g, "\n").replace(/\\"/g, '"').trim();
      const hashtags = [...new Set(unfenced.match(/#[\p{L}\p{N}_-]+/gu) || [])];
      return { title, body, hashtags };
    }

    const headingTitle = unfenced.match(/^#\s*(.+)$/m)?.[1]?.trim();
    const colonTitle = unfenced.match(/(?:^|\n)(?:제목|title)\s*:\s*(.+)/i)?.[1]?.trim();
    const firstLine = unfenced.split(/\n+/).find((line) => line.trim() && !line.includes("{") && !line.includes("}"))?.trim() || "";
    const title = headingTitle || colonTitle || firstLine.slice(0, 80) || "자동 생성 블로그 글";

    const hashtags = [...new Set(unfenced.match(/#[\p{L}\p{N}_-]+/gu) || [])];

    // Clean up if it just dumped markdown
    const body = unfenced
      .replace(/^#\s*.+$/m, "")
      .replace(/(?:^|\n)(?:제목|title)\s*:\s*.+/i, "")
      .replace(/^{|}$/g, "")
      .replace(/"title"\s*:\s*".*?"/g, "")
      .replace(/"body"\s*:\s*"/g, "")
      .replace(/"hashtags"\s*:.*?\]/g, "")
      .trim();

    if (!body) {
      throw new Error("Model output is not valid JSON");
    }

    return {
      title,
      body,
      hashtags,
    };
  }
}

export async function rewriteDraftWithLLM({
  userId,
  baseDraft,
  styleProfile,
  instagramItems,
  llmProvider = "openai",
}) {
  const provider = llmProvider === "cloudflare" ? "cloudflare" : llmProvider === "gemini" ? "gemini" : llmProvider === "google-colab" ? "google-colab" : llmProvider === "ollama" ? "ollama" : "openai";
  const runtime = buildClient(provider);

  if (!runtime.ok) {
    return {
      draft: {
        ...baseDraft,
        llmApplied: false,
        llmReason: runtime.reason,
      },
      llmMeta: {
        enabled: false,
        provider,
        reason: runtime.reason,
      },
    };
  }

  const sourceSummary = instagramItems
    .map((item, i) => {
      const title = item.title || `콘텐츠 ${i + 1}`;
      const desc = stripSocialNoise((item.description || item.excerpt || "").slice(0, 500));
      const mediaSummary = Array.isArray(item.mediaItems)
        ? item.mediaItems
          .slice(0, 6)
          .map((m, idx) => `  - media ${idx + 1} [${m.type || "unknown"}]: ${m.url || ""}`)
          .join("\n")
        : "";
      return `- ${title}: ${desc}${mediaSummary ? `\n${mediaSummary}` : ""}`;
    })
    .join("\n");

  const messages = buildMessages({ styleProfile, sourceSummary, baseDraft });

  try {
    const completion = await callChatCompletion({
      client: runtime.client,
      model: runtime.model,
      messages,
      provider,
    });

    const parsed = parseCompletionJson(completion);
    const normalized = normalizeGeneratedDraft(parsed, baseDraft);

    const merged = buildDraftOutput({
      userId,
      title: normalized.title,
      toneGuide: baseDraft.toneGuide,
      body: normalized.body,
      hashtags: normalized.hashtags,
      meta: {
        llmApplied: true,
        llmModel: runtime.model,
        llmProvider: provider,
        llmFallbackUsed: normalized.degradedToBase,
        llmFallbackReason: normalized.reason || "",
        llmRawBody: normalized.rawBody || "",
      },
    });

    return {
      draft: merged,
      llmMeta: {
        enabled: true,
        provider,
        model: runtime.model,
        prompt: messages,
      },
    };
  } catch (error) {
    return {
      draft: {
        ...baseDraft,
        llmApplied: false,
        llmReason: error instanceof Error ? error.message : "Unknown LLM error",
        llmProvider: provider,
      },
      llmMeta: {
        enabled: true,
        provider,
        model: runtime.model,
        prompt: messages,
        error: error instanceof Error ? error.message : "Unknown LLM error",
      },
    };
  }
}

function extractText(completion) {
  const raw = completion.choices?.[0]?.message?.content;
  if (!raw) return "";
  if (Array.isArray(raw)) {
    return raw.map(p => (typeof p === "string" ? p : p.text || "")).join("\n").trim();
  }
  return String(raw).trim();
}

export async function generateStep1Outline({ instagramItems, llmProvider = "openai" }) {
  const provider = llmProvider === "cloudflare" ? "cloudflare" : llmProvider === "gemini" ? "gemini" : llmProvider === "google-colab" ? "google-colab" : llmProvider === "ollama" ? "ollama" : "openai";
  const runtime = buildClient(provider);
  if (!runtime.ok) throw new Error(runtime.reason);

  const sourceSummary = instagramItems.map((item, i) => {
    const title = item.title || `콘텐츠 ${i + 1}`;
    const desc = stripSocialNoise((item.description || item.excerpt || "").slice(0, 500));
    return `- ${title}:\n  ${desc}`;
  }).join("\n\n");

  const system = "너는 소셜 미디어 포스트를 바탕으로 블로그 글의 개요(Outline)를 짜는 기획자다.\n주어진 글이 아주 짧더라도, 상황과 배경을 조금 더 상상해서 '도입 - 전개1 - 전개2 - 요약' 형태의 탄탄한 뼈대를 기획해라.\n마크다운(##)을 사용해서 각 소제목과 그 문단에서 다룰 내용을 간략히 나열해라.";
  const user = `[소셜 소스 요약]\n${sourceSummary}\n\n위 내용을 바탕으로 풍성한 블로그 글 작성을 위한 구조화된 개요를 짜줘. (순수 텍스트/마크다운 형식으로 응답할 것)`;

  const completion = await callChatCompletion({ client: runtime.client, model: runtime.model, messages: { system, user }, provider, jsonMode: false });
  return { outline: extractText(completion), prompt: { system, user } };
}

export async function generateStep2SEO({ outline, llmProvider = "openai" }) {
  const provider = llmProvider === "cloudflare" ? "cloudflare" : llmProvider === "gemini" ? "gemini" : llmProvider === "google-colab" ? "google-colab" : llmProvider === "ollama" ? "ollama" : "openai";
  const runtime = buildClient(provider);
  if (!runtime.ok) throw new Error(runtime.reason);

  const system = "너는 기획자가 짜준 개요(Outline)를 바탕으로, 가독성이 좋고 검색엔진(SEO)에 최적화된 '완성된 형태의 블로그 글'을 작성하는 전문 문서 작성자다.\n문체는 가장 평범하고 깔끔한 '입니다/습니다'나 '해요' 체를 사용해서 내용을 풍성하게 400~600 단어 이상의 길이로 꽉 채워 적어라.\n문단과 소제목(##)을 잘 나누고 자연스럽게 스토리를 이어가라. 절대 '초안'처럼 요약식으로 쓰지 말고, 발행 가능한 수준의 실제 글로 작성해라.\n응답은 JSON 스키마만 반환한다.";
  const user = `[블로그 기획안(개요)]\n${outline}\n\n아래 JSON 스키마로만 반환하라:\n{"title":"매력적인 검색용 블로그 제목","body":"완성된 형태의 본문 전체 내용(마크다운 포함)","hashtags":["#태그1","#태그2"]}`;

  const completion = await callChatCompletion({ client: runtime.client, model: runtime.model, messages: { system, user }, provider, jsonMode: true });
  const parsed = parseCompletionJson(completion);
  if (!parsed || !parsed.body) throw new Error("JSON 파싱 에러(SEO 단계)");
  return { ...parsed, prompt: { system, user } };
}

export async function generateStep3Style({ userId, seoDraft, styleProfile, llmProvider = "openai" }) {
  const provider = llmProvider === "cloudflare" ? "cloudflare" : llmProvider === "gemini" ? "gemini" : llmProvider === "google-colab" ? "google-colab" : llmProvider === "ollama" ? "ollama" : "openai";
  const runtime = buildClient(provider);
  if (!runtime.ok) throw new Error(runtime.reason);

  const stylePromptText = stylePrompt(styleProfile);
  const persona = styleProfile?.llmStyle?.personaSummary || "알 수 없음";
  const rules = styleProfile?.llmStyle?.styleRules || [];
  const rulesText = rules.length ? rules.map((x, i) => `${i + 1}. ${x}`).join("\n") : "없음";
  const samplesText = fewShotStyleExamples(styleProfile);

  const system = "너는 주어진 SEO 블로그 원고의 내용을 유지하면서, 특정인의 '완벽한 말투(문체)와 감성'으로 리라이팅(Rewriting) 해주는 전문 대필 에디터다.\n내용은 빼지 말고 톤앤매너, 문장 길이, 종결 어미, 사용하는 이모지 패턴만 바꿔라.\n응답은 JSON 스키마만 반환한다.";

  const user = `[목표 문체 프로필]\n${stylePromptText}\n페르소나: ${persona}\n규칙:\n${rulesText}\n\n[문체 샘플]\n${samplesText}\n\n[적용을 위한 원본 SEO 초안]\n제목: ${seoDraft.title}\n본문:\n${seoDraft.body}\n해시태그: ${seoDraft.hashtags?.join(" ")}\n\n위 내용에 목표 문체를 100% 덮어씌워서 다시 JSON 스키마로만 반환하라:\n{"title":"스타일이 반영된 찰떡같은 제목","body":"스타일이 반영된 본문 전체 내용","hashtags":["#태그1"]}`;

  const completion = await callChatCompletion({ client: runtime.client, model: runtime.model, messages: { system, user }, provider, jsonMode: true });
  const parsed = parseCompletionJson(completion);
  if (!parsed || !parsed.body) throw new Error("JSON 파싱 에러(스타일 단계)");

  // 최종 형태의 Draft 구조로 패키징
  return buildDraftOutput({
    userId,
    title: parsed.title,
    toneGuide: "사용자 커스텀 스타일 적용 완료",
    body: parsed.body,
    hashtags: parsed.hashtags || seoDraft.hashtags || [],
    meta: {
      llmApplied: true,
      llmModel: runtime.model,
      llmProvider: provider,
      llmFallbackUsed: false,
      llmPrompt: { system, user }
    },
  });
}

export async function generateOutlineMVP({ blogType, keywords, memo, imagesData = [], llmProvider = "openai", geminiModel, openaiModel, colabAddress, isPreview = false }) {
  const provider = llmProvider === "cloudflare" ? "cloudflare" : llmProvider === "gemini" ? "gemini" : llmProvider === "google-colab" ? "google-colab" : llmProvider === "ollama" ? "ollama" : "openai";

  const system = "너는 검색엔진 최적화(SEO)와 블로그 기획의 전문가이다.\n사용자가 제공한 [블로그 성격, 타겟 키워드, 간략 메모, 장별 사진 설명]를 분석하여 매력적인 블로그 제목 후보 3개와 본문 작성용 뼈대(목차)를 기획하라.\n개요는 서론, 본론(소제목 여러 개), 결론으로 명확히 구분되어야 한다.\n반드시 JSON 스키마만 반환할 것: {\"titles\": [\"제목1\",\"제목2\",\"제목3\"], \"outline\": \"마크다운 형태의 상세한 목차 내용\"}";
  const user = `블로그 성격: ${blogType}\n타겟 키워드: ${keywords}\n업로드된 사진 정보:\n${imagesData.map(img => `[사진 ${img.idx}] ${img.caption}`).join("\n")}\n내용 메모: ${memo}\n\n위 내용을 바탕으로 검색 상위 노출에 유리하고 클릭을 유도할 수 있는 제목 3개와 구체적인 글 작성 뼈대를 잡아줘.`;

  if (isPreview) {
    return { prompt: { system, user } };
  }

  const runtime = buildClient(provider, geminiModel, openaiModel);
  if (!runtime.ok) throw new Error(runtime.reason);

  const completion = await callChatCompletion({ client: runtime.client, model: runtime.model, messages: { system, user }, provider, jsonMode: true, colabAddress });
  const parsed = parseCompletionJson(completion);
  const titles = parsed?.titles || parsed?.title || parsed?.blog_titles || ["추천 제목"];
  const outline = typeof parsed?.outline === "string" ? parsed.outline : typeof parsed?.blog_outline === "string" ? parsed.blog_outline : JSON.stringify(parsed, null, 2);
  if (!titles || !outline) throw new Error("JSON 파싱 에러(MVP Outline): " + JSON.stringify(parsed));
  return { titles, outline, prompt: { system, user } };
}

export async function generateFinalMVP({
  blogType,
  keywords,
  title,
  structuredInfo,
  imagesMeta,
  persona,
  // legacy(deprecated):
  outline,
  imagesData = [],
  options,
  styleProfile,
  llmProvider = "openai",
  geminiModel,
  openaiModel,
  colabAddress,
  isPreview = false,
}) {
  const provider =
    llmProvider === "cloudflare"
      ? "cloudflare"
      : llmProvider === "gemini"
        ? "gemini"
        : llmProvider === "google-colab"
          ? "google-colab"
          : llmProvider === "ollama"
            ? "ollama"
            : "openai";

  const styleGuide = options?.optStyle ? styleProfile?.llmStyle?.rawJson?.style_guide || null : null;
  const legacyImagesMeta =
    Array.isArray(imagesMeta) && imagesMeta.length
      ? imagesMeta
      : Array.isArray(imagesData)
        ? imagesData.map((img, idx) => ({
          slot: `PHOTO_${idx + 1}`,
          subject: String(img?.caption || img?.description || `사진 ${idx + 1}`),
          highlight: String(img?.description || img?.caption || ""),
          feeling: "",
          url: String(img?.url || ""),
        }))
        : [];

  const result = await runWriterPipeline({
    blogType,
    keywords,
    title,
    structuredInfo: structuredInfo || (outline ? { extra_notes: String(outline) } : undefined),
    imagesMeta: legacyImagesMeta,
    persona,
    styleGuide,
    providerConfig: {
      provider,
      ...(provider === "gemini" && geminiModel ? { model: geminiModel } : {}),
      ...(provider === "openai" && openaiModel ? { model: openaiModel } : {}),
      ...(provider === "google-colab" && colabAddress ? { colabAddress } : {}),
    },
    constraints: {},
    isPreview,
  });

  if (isPreview) {
    return { prompt: result.prompt };
  }

  return {
    title_suggestions: result.title_suggestions,
    markdown: result.markdown,
    hashtags: result.hashtags,
    image_plan: result.image_plan,
    quality_checks: result.quality_checks,
    prompt: result.prompt,
    llm_response: result.llmMeta?.rawText || "",
    llm_responses: Array.isArray(result.llmMeta?.rawResponses)
      ? result.llmMeta.rawResponses.map((item) => ({
        attempt: item?.attempt,
        provider: item?.provider,
        model: item?.model,
        raw_text: String(item?.rawText || ""),
      }))
      : [],
  };
}

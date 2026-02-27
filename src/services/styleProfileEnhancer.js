import { runStyleInferencePipeline } from "./styleService.js";

function toProvider(provider) {
  const raw = String(provider || "openai").trim().toLowerCase();
  if (["openai", "gemini", "cloudflare", "ollama", "google-colab"].includes(raw)) return raw;
  return "openai";
}

export async function enhanceStyleProfileWithLLM({
  pages,
  llmProvider = "openai",
  openaiModel,
  userId = "demo-user",
}) {
  const provider = toProvider(llmProvider);

  const posts = (Array.isArray(pages) ? pages : []).map((page, idx) => ({
    source_url: page?.url || `https://example.com/post-${idx + 1}`,
    title: page?.title || `포스트 ${idx + 1}`,
    content_text: String(page?.text || ""),
  }));

  try {
    const result = await runStyleInferencePipeline({
      posts,
      providerConfig: {
        provider,
        ...(openaiModel ? { model: openaiModel } : {}),
      },
    });

    return {
      ok: true,
      provider,
      model: openaiModel || undefined,
      llm_response: String(result?.llm?.rawText || ""),
      llm_responses: Array.isArray(result?.llm?.rawResponses) ? result.llm.rawResponses : [],
      enhancement: {
        voiceSummary: Array.isArray(result.styleGuide?.lexicon?.tone_keywords)
          ? result.styleGuide.lexicon.tone_keywords.join(", ")
          : "",
        personaSummary: "문체/구성 중심 스타일 프로필",
        stylePrompt: result.stylePrompt,
        rawJson: {
          style_guide: result.styleGuide,
          confidence: result.confidence,
        },
      },
      prompt: {
        system: "src/prompts/style_profiler.system.md",
        user: "src/prompts/style_profiler.user.md",
      },
      userId,
    };
  } catch (error) {
    const rawResponses = Array.isArray(error?.llmResponses)
      ? error.llmResponses.map((item, idx) => ({
        attempt: Number(item?.attempt || idx + 1),
        provider: String(item?.provider || provider || ""),
        model: String(item?.model || ""),
        raw_text: String(item?.rawText || item?.raw_text || ""),
      }))
      : [];
    return {
      ok: false,
      provider,
      reason: error instanceof Error ? error.message : "Unknown style enhancement error",
      llm_response: rawResponses.length ? rawResponses[rawResponses.length - 1].raw_text : "",
      llm_responses: rawResponses,
      userId,
    };
  }
}

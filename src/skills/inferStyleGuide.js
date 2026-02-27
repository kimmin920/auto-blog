import path from "node:path";
import { loadPrompt } from "../utils/loadPrompt.js";
import { recoverUserSamples } from "../utils/recoverUserSamples.js";
import { callLlmJson } from "./callLlmJson.js";

const MIN_USER_SAMPLES = 8;
const MAX_USER_SAMPLES = 12;
const MIN_PER_SOURCE_SAMPLES = 3;
const STYLE_PROMPT_SAMPLE_LIMIT = 12;
const EXCERPT_MIN_CHARS = 30;
const EXCERPT_MAX_CHARS = 120;
const DIVERSE_CATEGORIES = ["opener", "info", "emotion", "question", "tip", "list", "cta", "narrative"];

const STYLE_OUTPUT_SCHEMA = {
  style_guide: {
    writing_rules: "object",
    lexicon: {
      frequent_phrases: ["string"],
      favorite_phrases: ["string"],
      tone_keywords: ["string"],
      avoid_phrases: ["string"],
      portable_style_signals: ["string"],
      domain_locked_tokens: ["string"],
    },
    signature_rules: {
      parenthetical_aside: {
        min_count: "number",
        examples: ["string"],
      },
      relief_phrase: {
        candidates: ["string"],
        exact_count: "number",
        placement_hint: "string",
      },
      recommend_phrase: {
        candidates: ["string"],
        exact_count: "number",
        placement_hint: "string",
      },
    },
    banned_phrases: ["string"],
    style_examples: {
      user_samples: [
        {
          source_url: "string",
          excerpt: "string",
          why_it_matters: "string",
        },
      ],
      do_not_copy_verbatim_long: "boolean",
    },
  },
  confidence: {
    overall: "string",
    signals: ["string"],
    limitations: ["string"],
  },
};

function toStringSafe(value) {
  return String(value ?? "").trim();
}

function toStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v ?? "").trim()).filter(Boolean);
}

function uniqueStrings(list, limit = 30) {
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(list) ? list : []) {
    const text = String(item ?? "").trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

function pickFirstNonEmpty(...values) {
  for (const value of values) {
    const text = toStringSafe(value);
    if (text) return text;
  }
  return "";
}

function toNonNegativeInt(value, fallback = 0) {
  const n = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

function normalizeLexicon(lexicon) {
  const base = lexicon && typeof lexicon === "object" ? lexicon : {};
  const frequentPhrases = uniqueStrings(base.frequent_phrases || base.frequent_words || []);
  const favoritePhrases = uniqueStrings(base.favorite_phrases || []);
  const toneKeywords = uniqueStrings(base.tone_keywords || []);
  const avoidPhrases = uniqueStrings(base.avoid_phrases || base.avoid_expressions || []);

  const portableSignals = uniqueStrings(
    base.portable_style_signals
      || base.style_portable_signals
      || [...frequentPhrases, ...favoritePhrases]
  );
  const domainLocked = uniqueStrings(base.domain_locked_tokens || base.domain_specific_terms || []);

  return {
    ...base,
    frequent_phrases: frequentPhrases,
    favorite_phrases: favoritePhrases,
    tone_keywords: toneKeywords,
    avoid_phrases: avoidPhrases,
    portable_style_signals: portableSignals,
    domain_locked_tokens: domainLocked,
  };
}

function normalizeSignatureRules(signatureRules) {
  const base = signatureRules && typeof signatureRules === "object" ? signatureRules : {};
  const parenthetical = base.parenthetical_aside && typeof base.parenthetical_aside === "object"
    ? base.parenthetical_aside
    : {};
  const relief = base.relief_phrase && typeof base.relief_phrase === "object"
    ? base.relief_phrase
    : {};
  const recommend = base.recommend_phrase && typeof base.recommend_phrase === "object"
    ? base.recommend_phrase
    : {};

  return {
    parenthetical_aside: {
      min_count: toNonNegativeInt(parenthetical.min_count, 0),
      examples: uniqueStrings(parenthetical.examples || [], 8),
    },
    relief_phrase: {
      candidates: uniqueStrings(relief.candidates || [], 8),
      exact_count: toNonNegativeInt(relief.exact_count, 0),
      placement_hint: toStringSafe(relief.placement_hint || ""),
    },
    recommend_phrase: {
      candidates: uniqueStrings(recommend.candidates || [], 8),
      exact_count: toNonNegativeInt(recommend.exact_count, 0),
      placement_hint: toStringSafe(recommend.placement_hint || ""),
    },
  };
}

function normalizeSpaces(text) {
  return String(text ?? "")
    .replace(/\u200b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isMissingField(text) {
  const t = toStringSafe(text);
  if (!t) return true;
  return t.toLowerCase() === "undefined" || t.toLowerCase() === "null";
}

function looksLikeJsonFragment(text) {
  const t = String(text ?? "");
  if (!t) return false;
  if (/[{}]/.test(t)) return true;
  if (/\"[^\"]+\"\s*:/.test(t)) return true;
  if (/^\s*(source_url|excerpt|why_it_matters)\s*:/.test(t)) return true;
  return false;
}

function excerptKey(text) {
  return normalizeSpaces(text).toLowerCase();
}

function trimExcerpt(text) {
  const compact = normalizeSpaces(text);
  if (!compact || compact.length < EXCERPT_MIN_CHARS) return "";
  if (looksLikeJsonFragment(compact)) return "";
  if (compact.length <= EXCERPT_MAX_CHARS) return compact;
  const trimmed = compact.slice(0, EXCERPT_MAX_CHARS).trim();
  return looksLikeJsonFragment(trimmed) ? "" : trimmed;
}

function splitCandidateChunks(rawText) {
  const text = String(rawText ?? "").replace(/\r/g, "\n");
  if (!text.trim()) return [];

  const chunks = [
    ...text.split(/\n{2,}/),
    ...text.split(/(?<=[.!?！？…])\s+|\n+/),
  ];

  const out = [];
  const seen = new Set();
  for (const chunk of chunks) {
    const compact = normalizeSpaces(chunk);
    if (!compact) continue;
    const key = excerptKey(compact);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(compact);

    // For long paragraphs, also expose sliding windows so sparse posts still yield enough excerpts.
    if (compact.length > EXCERPT_MAX_CHARS + 40) {
      const step = Math.max(EXCERPT_MIN_CHARS, Math.floor(EXCERPT_MAX_CHARS * 0.75));
      for (let i = 0; i < compact.length; i += step) {
        const windowed = compact.slice(i, i + EXCERPT_MAX_CHARS).trim();
        if (windowed.length < EXCERPT_MIN_CHARS) continue;
        const winKey = excerptKey(windowed);
        if (seen.has(winKey)) continue;
        seen.add(winKey);
        out.push(windowed);
      }
    }
  }
  return out;
}

function detectExcerptCategory(excerpt) {
  const text = String(excerpt ?? "");
  if (/댓글|이웃|공감|다음편|궁금|알려(주|줘)/.test(text)) return "cta";
  if (/[?？]/.test(text) || /나요|까요|어때|어떤가|있나요|있으세요/.test(text)) return "question";
  if (/tip|꿀팁|정리|포인트|체크|참고|주의|주차|대기/i.test(text)) return "tip";
  if (/^\d+\./.test(text) || /^[\-•✔✅📌]/.test(text)) return "list";
  if (/와|헉|대박|진짜|정말|너무|짱|최고|ㅠ|ㅋㅋ|!/.test(text)) return "emotion";
  if (/위치|메뉴|가격|주차|시간|영업|구성|특징|분위기|설명|정보|포인트/.test(text)) return "info";
  if (/처음|전날|이번|다녀왔|먹어봤|써봤|느꼈/.test(text)) return "narrative";
  return "opener";
}

function whyItMattersByCategory(category) {
  if (category === "cta") return "마무리에서 댓글·이웃 유도를 넣는 CTA 패턴을 보여준다.";
  if (category === "question") return "질문형 말끝으로 독자 공감과 상호작용을 끌어내는 패턴이다.";
  if (category === "tip") return "실용 정보를 짧은 라벨형 문장으로 정리하는 습관을 드러낸다.";
  if (category === "list") return "목록형 전개로 핵심을 빠르게 전달하는 구성 습관이 보인다.";
  if (category === "emotion") return "감탄/감정 어휘와 구어체 말끝으로 현장감을 높이는 스타일이다.";
  if (category === "info") return "정보를 단정하고 간결하게 설명하는 문장 패턴을 보여준다.";
  if (category === "narrative") return "경험 서술 중심의 흐름으로 후기형 톤을 형성한다.";
  return "도입부에서 리듬과 톤을 만드는 문장 습관을 보여준다.";
}

function sanitizeBaseSamples(samples) {
  const normalized = recoverUserSamples(samples || []);
  const out = [];
  const seen = new Set();

  for (const sample of normalized) {
    if (isMissingField(sample?.source_url) || isMissingField(sample?.why_it_matters)) continue;
    const excerpt = trimExcerpt(sample?.excerpt);
    if (!excerpt) continue;
    if (isMissingField(excerpt) || looksLikeJsonFragment(excerpt)) continue;
    const key = excerptKey(excerpt);
    if (seen.has(key)) continue;
    seen.add(key);

    const category = detectExcerptCategory(excerpt);
    out.push({
      source_url: toStringSafe(sample?.source_url) || "sample",
      excerpt,
      why_it_matters: toStringSafe(sample?.why_it_matters) || whyItMattersByCategory(category),
      _category: category,
    });
    if (out.length >= MAX_USER_SAMPLES) break;
  }

  return out;
}

function collectSupplementalCandidates(posts, usedKeys) {
  const out = [];
  const seen = new Set(Array.isArray(usedKeys) ? usedKeys : []);

  (Array.isArray(posts) ? posts : []).forEach((post, idx) => {
    const sourceUrl = toStringSafe(post?.source_url || post?.url || `sample_${idx}`);
    const chunks = splitCandidateChunks(post?.content_text || post?.text || "").slice(0, 80);

    for (const chunk of chunks) {
      const excerpt = trimExcerpt(chunk);
      if (!excerpt) continue;
      const key = excerptKey(excerpt);
      if (seen.has(key)) continue;
      seen.add(key);

      const category = detectExcerptCategory(excerpt);
      out.push({
        source_url: sourceUrl,
        excerpt,
        why_it_matters: whyItMattersByCategory(category),
        _category: category,
      });
    }
  });

  return out;
}

function countBySource(samples) {
  const map = new Map();
  for (const sample of samples) {
    const key = toStringSafe(sample?.source_url) || "sample";
    map.set(key, (map.get(key) || 0) + 1);
  }
  return map;
}

function sourceOrder(posts) {
  const seen = new Set();
  const order = [];
  for (let i = 0; i < (Array.isArray(posts) ? posts.length : 0); i += 1) {
    const sourceUrl = toStringSafe(posts[i]?.source_url || posts[i]?.url || `sample_${i}`);
    if (!sourceUrl || seen.has(sourceUrl)) continue;
    seen.add(sourceUrl);
    order.push(sourceUrl);
  }
  return order;
}

function stripPrivateSampleFields(samples) {
  return samples.map(({ _category, ...rest }) => rest);
}

export function enforceMinimumUserSamples({ samples, posts, minSamples = MIN_USER_SAMPLES, maxSamples = MAX_USER_SAMPLES }) {
  const safeMax = Math.max(1, Number(maxSamples) || MAX_USER_SAMPLES);
  const safeMin = Math.max(1, Math.min(Number(minSamples) || MIN_USER_SAMPLES, safeMax));
  const result = sanitizeBaseSamples(samples);

  if (result.length >= safeMin) {
    return stripPrivateSampleFields(result.slice(0, safeMax));
  }

  const existingKeys = result.map((s) => excerptKey(s.excerpt));
  const candidates = collectSupplementalCandidates(posts, existingKeys);
  const perSourceCounts = countBySource(result);
  const preferredSourceOrder = sourceOrder(posts);

  const takeAt = (index) => {
    if (index < 0 || index >= candidates.length) return;
    const [picked] = candidates.splice(index, 1);
    if (!picked) return;
    const src = toStringSafe(picked.source_url) || "sample";
    perSourceCounts.set(src, (perSourceCounts.get(src) || 0) + 1);
    result.push(picked);
  };

  for (const src of preferredSourceOrder) {
    if (result.length >= safeMax) break;
    const available = candidates.filter((c) => c.source_url === src).length;
    const current = perSourceCounts.get(src) || 0;
    const targetForSource = Math.min(MIN_PER_SOURCE_SAMPLES, current + available);
    while ((perSourceCounts.get(src) || 0) < targetForSource && result.length < safeMax) {
      const idx = candidates.findIndex((c) => c.source_url === src);
      if (idx < 0) break;
      takeAt(idx);
    }
  }

  const existingCategories = new Set(result.map((s) => s._category).filter(Boolean));
  for (const category of DIVERSE_CATEGORIES) {
    if (result.length >= safeMax) break;
    if (existingCategories.has(category)) continue;
    const idx = candidates.findIndex((c) => c._category === category);
    if (idx < 0) continue;
    takeAt(idx);
    existingCategories.add(category);
  }

  while (result.length < safeMin && candidates.length > 0 && result.length < safeMax) {
    takeAt(0);
  }

  return stripPrivateSampleFields(result.slice(0, safeMax));
}

function buildStylePrompt(styleGuide) {
  const rules = styleGuide?.writing_rules || {};
  const lexicon = normalizeLexicon(styleGuide?.lexicon || {});
  const signatureRules = normalizeSignatureRules(styleGuide?.signature_rules || {});
  const sentenceStyle = rules?.sentence_style || {};
  const samples = recoverUserSamples(styleGuide?.style_examples?.user_samples || []).slice(0, STYLE_PROMPT_SAMPLE_LIMIT);
  const lines = [];

  lines.push("## 문체 가이드");
  if (rules?.structure?.typical_flow) lines.push(`- 흐름: ${rules.structure.typical_flow}`);
  if (sentenceStyle?.avg_sentence_length) lines.push(`- 문장 길이: ${sentenceStyle.avg_sentence_length}`);
  if (rules?.formatting?.line_break_density) lines.push(`- 줄바꿈 밀도: ${rules.formatting.line_break_density}`);

  const endingSummary = pickFirstNonEmpty(
    sentenceStyle?.ending_style_summary,
    sentenceStyle?.ending_style,
    sentenceStyle?.ending_pattern_summary
  );
  if (endingSummary) lines.push(`- 말끝/종결 패턴: ${endingSummary}`);

  const honorificMix = pickFirstNonEmpty(
    sentenceStyle?.honorific_mix,
    sentenceStyle?.speech_level_mix,
    sentenceStyle?.register_mix
  );
  if (honorificMix) lines.push(`- 존댓말/반말 혼용: ${honorificMix}`);

  const suffixPatterns = toStringArray(
    sentenceStyle?.casual_suffix_patterns
      || sentenceStyle?.ending_suffix_patterns
      || sentenceStyle?.special_endings
  );
  if (suffixPatterns.length) lines.push(`- 자주 쓰는 말끝 변형: ${suffixPatterns.join(", ")}`);

  const endingSwitch = pickFirstNonEmpty(
    sentenceStyle?.ending_switch_context,
    sentenceStyle?.switching_rules,
    sentenceStyle?.tone_shift_context
  );
  if (endingSwitch) lines.push(`- 말투 전환 규칙: ${endingSwitch}`);

  const tones = Array.isArray(lexicon?.tone_keywords) ? lexicon.tone_keywords.filter(Boolean) : [];
  if (tones.length) lines.push(`- 톤 키워드: ${tones.join(", ")}`);

  const portableSignals = toStringArray(lexicon?.portable_style_signals);
  if (portableSignals.length) lines.push(`- 재사용 가능한 스타일 신호: ${portableSignals.join(", ")}`);

  const domainLocked = toStringArray(lexicon?.domain_locked_tokens);
  if (domainLocked.length) lines.push(`- 도메인 고정 토큰(주제 변경 시 비활성화): ${domainLocked.join(", ")}`);

  if (signatureRules.parenthetical_aside.min_count > 0) {
    const asideExamples = signatureRules.parenthetical_aside.examples.length
      ? ` (예: ${signatureRules.parenthetical_aside.examples.join(", ")})`
      : "";
    lines.push(`- 괄호 보조 코멘트 최소 ${signatureRules.parenthetical_aside.min_count}회${asideExamples}`);
  }
  if (signatureRules.relief_phrase.exact_count > 0 && signatureRules.relief_phrase.candidates.length) {
    lines.push(
      `- 해소형 표현 정확히 ${signatureRules.relief_phrase.exact_count}회 (${signatureRules.relief_phrase.candidates.join(", ")})` +
      (signatureRules.relief_phrase.placement_hint ? `, 위치: ${signatureRules.relief_phrase.placement_hint}` : "")
    );
  }
  if (signatureRules.recommend_phrase.exact_count > 0 && signatureRules.recommend_phrase.candidates.length) {
    lines.push(
      `- 추천 표현 정확히 ${signatureRules.recommend_phrase.exact_count}회 (${signatureRules.recommend_phrase.candidates.join(", ")})` +
      (signatureRules.recommend_phrase.placement_hint ? `, 위치: ${signatureRules.recommend_phrase.placement_hint}` : "")
    );
  }

  const banned = Array.isArray(styleGuide?.banned_phrases) ? styleGuide.banned_phrases.filter(Boolean) : [];
  if (banned.length) lines.push(`- 금지 표현: ${banned.join(", ")}`);

  if (samples.length) {
    lines.push("\n## 문체 샘플");
    for (const sample of samples) {
      if (!sample.excerpt || !sample.why_it_matters) continue;
      lines.push(`- "${sample.excerpt}" (${sample.why_it_matters})`);
    }
  }

  return lines.join("\n");
}

function normalizeStyleGuidePayload(payload, posts) {
  const root = payload && typeof payload === "object" ? payload : {};
  const styleGuide = root.style_guide && typeof root.style_guide === "object" ? root.style_guide : {};
  const normalizedLexicon = normalizeLexicon(styleGuide.lexicon || {});
  const normalizedSignatureRules = normalizeSignatureRules(styleGuide.signature_rules || {});
  const styleExamples = styleGuide.style_examples && typeof styleGuide.style_examples === "object"
    ? styleGuide.style_examples
    : {};

  const recoveredSamples = enforceMinimumUserSamples({
    samples: styleExamples.user_samples || [],
    posts,
    minSamples: MIN_USER_SAMPLES,
    maxSamples: MAX_USER_SAMPLES,
  });
  const baseConfidence =
    root.confidence && typeof root.confidence === "object"
      ? root.confidence
      : { overall: "low", signals: [], limitations: ["confidence not provided"] };
  const limitations = Array.isArray(baseConfidence.limitations)
    ? [...baseConfidence.limitations.map((item) => toStringSafe(item)).filter(Boolean)]
    : [];
  if (recoveredSamples.length < MIN_USER_SAMPLES) {
    limitations.push(
      `입력 텍스트 밀도 한계로 user_samples가 ${MIN_USER_SAMPLES}개 미만(${recoveredSamples.length}개)입니다.`
    );
  }

  return {
    rawJson: root,
    styleGuide: {
      ...styleGuide,
      lexicon: normalizedLexicon,
      signature_rules: normalizedSignatureRules,
      style_examples: {
        ...styleExamples,
        user_samples: recoveredSamples,
        do_not_copy_verbatim_long: true,
      },
    },
    confidence: {
      ...baseConfidence,
      limitations,
    },
  };
}

export async function inferStyleGuide({ posts, providerConfig = {} }) {
  const systemPath = path.resolve(process.cwd(), "src/prompts/style_profiler.system.md");
  const userPath = path.resolve(process.cwd(), "src/prompts/style_profiler.user.md");
  const [systemPrompt, userTemplate] = await Promise.all([loadPrompt(systemPath), loadPrompt(userPath)]);

  const input = {
    task: "infer_style_guide_only",
    inputs: {
      posts: (Array.isArray(posts) ? posts : []).map((post, idx) => ({
        source_url: String(post?.url || post?.source_url || `sample_${idx}`).trim(),
        title: String(post?.title || "").trim(),
        content_text: String(post?.text || post?.content_text || "").slice(0, 9000),
      })),
    },
    output: { schema: STYLE_OUTPUT_SCHEMA },
  };

  const userPromptJson = userTemplate.replace("{{INPUT_JSON}}", JSON.stringify(input, null, 2));
  const completion = await callLlmJson({
    providerConfig,
    systemPrompt,
    userPromptJson,
    outputSchema: STYLE_OUTPUT_SCHEMA,
  });

  const normalized = normalizeStyleGuidePayload(completion.json, input.inputs.posts);
  const llmResponses = Array.isArray(completion.rawResponses)
    ? completion.rawResponses.map((item, idx) => ({
      attempt: Number(item?.attempt || idx + 1),
      provider: String(item?.provider || completion.provider || ""),
      model: String(item?.model || completion.model || ""),
      raw_text: String(item?.rawText || ""),
    }))
    : [];

  return {
    styleGuide: normalized.styleGuide,
    stylePrompt: buildStylePrompt(normalized.styleGuide),
    confidence: normalized.confidence,
    rawJson: normalized.rawJson,
    llm: {
      provider: completion.provider,
      model: completion.model,
      rawText: String(completion.rawText || ""),
      rawResponses: llmResponses,
    },
  };
}

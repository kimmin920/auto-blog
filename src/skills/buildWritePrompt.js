import path from "node:path";
import { loadPrompt } from "../utils/loadPrompt.js";
import { normalizeStyleExamples } from "../services/utils.js";

const MUST_INCLUDE_SECTIONS = [
  "방문 배경",
  "위치/주차",
  "대표 메뉴",
  "맛/식감 포인트",
  "TIP/정리",
  "마무리(질문+댓글+이웃)",
];

const OUTPUT_SCHEMA_SPEC = {
  title_suggestions: ["string"],
  markdown: "string",
  hashtags: ["string"],
  image_plan: [
    {
      slot: "string",
      anchor: "string",
      subject: "string",
      suggested_caption: "string",
      placement_hint: "string",
    },
  ],
  quality_checks: {
    length_rule: "boolean",
    emoji_rule: "boolean",
    banned_phrases_ok: "boolean",
    cta_included: "boolean",
    tip_box_included: "boolean",
    image_anchors_ok: "boolean",
    image_plan_ok: "boolean",
  },
};

const OUTPUT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title_suggestions", "markdown", "hashtags", "image_plan", "quality_checks"],
  properties: {
    title_suggestions: {
      type: "array",
      minItems: 5,
      maxItems: 5,
      items: { type: "string" },
    },
    markdown: { type: "string" },
    hashtags: {
      type: "array",
      minItems: 1,
      items: { type: "string" },
    },
    image_plan: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["slot", "anchor", "subject", "suggested_caption", "placement_hint"],
        properties: {
          slot: { type: "string" },
          anchor: { type: "string" },
          subject: { type: "string" },
          suggested_caption: { type: "string" },
          placement_hint: { type: "string" },
        },
      },
    },
    quality_checks: {
      type: "object",
      additionalProperties: false,
      required: [
        "length_rule",
        "emoji_rule",
        "banned_phrases_ok",
        "cta_included",
        "tip_box_included",
        "image_anchors_ok",
        "image_plan_ok",
      ],
      properties: {
        length_rule: { type: "boolean" },
        emoji_rule: { type: "boolean" },
        banned_phrases_ok: { type: "boolean" },
        cta_included: { type: "boolean" },
        tip_box_included: { type: "boolean" },
        image_anchors_ok: { type: "boolean" },
        image_plan_ok: { type: "boolean" },
      },
    },
  },
};

function inferPlacementHint(subject) {
  const s = String(subject || "").toLowerCase();
  if (/외관|간판/.test(s)) return "location_access";
  if (/내부|인테리어/.test(s)) return "interior";
  if (/메뉴|음식|전골|메인/.test(s)) return "main_menu";
  return "mid";
}

function hasPersona(persona) {
  if (!persona || typeof persona !== "object") return false;
  return Boolean(
    String(persona.identity || "").trim() ||
    String(persona.blog_focus || "").trim() ||
    String(persona.target_reader || "").trim() ||
    String(persona.goal || "").trim() ||
    String(persona.tone_note || "").trim()
  );
}

function buildDefaultStyleGuide(blogType) {
  return {
    banned_phrases: [],
    lexicon: {
      favorite_phrases: [],
      frequent_phrases: [],
      tone_keywords: [],
      avoid_phrases: [],
      portable_style_signals: [],
      domain_locked_tokens: [],
    },
    writing_rules: {
      length_policy: { target_chars: 1500, min_chars: 1000, max_chars: 3000, enforce: true },
      sentence_style: {
        avg_sentence_length: "medium",
        paragraph_length_sentences: "2-4",
        conversational_tone: "high",
        use_questions_exclamations: "high",
        emoji_usage_level: "medium",
        special_char_usage_level: "medium",
        use_bullets_for_info: "sometimes",
        use_parentheses_asides: "sometimes",
        onomatopoeia_usage: "sometimes",
        enforce: true,
      },
      formatting: {
        line_break_density: "high",
        heading_usage: "often",
        allow_bold: true,
        quote_style: "none",
        enforce: true,
      },
      structure: {
        typical_flow: "도입-전개-정리 흐름",
        cta_style: blogType === "info" ? "질문/댓글 + 이웃 추가 유도" : "질문/댓글 + 이웃 추가 유도",
        cta_frequency: "sometimes",
        enforce: true,
      },
    },
    signature_rules: {
      parenthetical_aside: {
        min_count: 0,
        examples: [],
      },
      relief_phrase: {
        candidates: [],
        exact_count: 0,
        placement_hint: "",
      },
      recommend_phrase: {
        candidates: [],
        exact_count: 0,
        placement_hint: "",
      },
    },
    style_examples: { must_mimic: true, user_samples: [] },
  };
}

export async function buildWritePrompt({ normalizedInputs, styleGuide, promptVersion = "v1" }) {
  const systemPath = path.resolve(process.cwd(), "src/prompts/write_post.system.md");
  const userPath = path.resolve(process.cwd(), "src/prompts/write_post.user.md");
  const [systemPrompt, userTemplate] = await Promise.all([loadPrompt(systemPath), loadPrompt(userPath)]);

  const guide = {
    ...buildDefaultStyleGuide(normalizedInputs.blogType),
    ...(styleGuide || {}),
  };
  guide.style_examples = normalizeStyleExamples(guide.style_examples || {});

  const normalizedImagesMeta = normalizedInputs.imagesMeta.map((img, idx) => ({
    slot: img.slot || `PHOTO_${idx + 1}`,
    subject: img.subject || "",
    highlight: img.highlight || "",
    feeling: img.feeling || "",
    url: img.url || "",
    anchor: `[사진 ${idx + 1}]`,
    placement_hint_default: inferPlacementHint(img.subject || ""),
  }));

  const payload = {
    task: "write_post",
    meta: {
      platform: "naver_blog",
      locale: "ko-KR",
      post_type: normalizedInputs.blogType,
      prompt_version: String(promptVersion || "v1"),
    },
    seo: {
      target_keywords: normalizedInputs.keywords,
      keyword_policy: {
        natural_inclusion: true,
        avoid_stuffing: true,
        min_mentions_each: 1,
        max_mentions_each: 6,
      },
      title_confirmed: normalizedInputs.title,
      title_generation_policy: {
        enabled: true,
        count: 5,
        style_reflect: true,
        include_keywords_naturally: true,
        avoid_clickbait_overclaim: true,
      },
    },
    style_guide: guide,
    persona: hasPersona(normalizedInputs.persona)
      ? {
        identity: normalizedInputs.persona.identity || "",
        blog_focus: normalizedInputs.persona.blog_focus || "",
        target_reader: normalizedInputs.persona.target_reader || "",
        goal: normalizedInputs.persona.goal || "",
        tone_note: normalizedInputs.persona.tone_note || "",
      }
      : null,
    inputs: {
      structured_info: normalizedInputs.structuredInfo,
      imagesMeta: normalizedImagesMeta,
    },
    must_include_sections: MUST_INCLUDE_SECTIONS,
    image_requirements: {
      expected_count: normalizedImagesMeta.length,
      anchor_format: "[사진 N]",
      rules:
        normalizedImagesMeta.length === 0
          ? "markdown에서 [사진 N] anchor를 모두 제거하고 image_plan은 []로 반환할 것"
          : "markdown에 [사진 1]..[사진 n] anchor를 각각 정확히 1회 포함하고 image_plan도 n개를 1:1 매핑할 것",
    },
    tip_box_policy: {
      enabled: true,
      placement: "auto",
      title_candidates: ["✅ TIP", "📌 정리", "TIP & 체크"],
      must_include: ["주차", "대기", "사진 포인트", "추천 조합 중 2~4개"],
      format: "markdown",
    },
    content_options: {
      include_tip_box: true,
      include_meme: false,
      writing_preference: {
        narrative_paragraph_ratio_min: 0.7,
        list_ratio_max: 0.3,
        max_numbered_headings: 3,
        avoid_summary_labels: ["한줄 요약", "총평(짧게)"],
        topic_lexicon_priority: ["inputs.structured_info", "seo.target_keywords"],
      },
    },
    assets: {
      placeholders: {
        image_slot: "[사진 N]",
      },
    },
    output: {
      schema: OUTPUT_JSON_SCHEMA,
      top_level_keys: ["title_suggestions", "markdown", "hashtags", "image_plan", "quality_checks"],
      additional_properties: false,
    },
  };

  const inputJson = JSON.stringify(payload, null, 2);
  const userPrompt = userTemplate.replace("{{INPUT_JSON}}", inputJson);

  return {
    systemPrompt,
    userPromptJson: payload,
    userPrompt,
    outputSchema: OUTPUT_SCHEMA_SPEC,
  };
}

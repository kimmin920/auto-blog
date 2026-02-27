import { normalizeInputs } from "../skills/normalizeInputs.js";
import { buildWritePrompt } from "../skills/buildWritePrompt.js";
import { callLlmJson } from "../skills/callLlmJson.js";
import { validateImageAnchorsAndPlan, validateOutput } from "../skills/validateOutput.js";

function styleGuideFromProfile(styleProfile) {
  return styleProfile?.llmStyle?.rawJson?.style_guide || null;
}

export async function runWriterPipeline({
  userId,
  styleGuide,
  styleProfile,
  loadStyleGuide,
  providerConfig = {},
  promptVersion = "v1",
  constraints = {},
  isPreview = false,
  ...input
}) {
  let resolvedStyleGuide = styleGuide || styleGuideFromProfile(styleProfile);

  if (!resolvedStyleGuide && typeof loadStyleGuide === "function") {
    resolvedStyleGuide = await loadStyleGuide(userId);
  }

  const normalizedInputs = normalizeInputs(input);
  const promptPack = await buildWritePrompt({
    normalizedInputs,
    styleGuide: resolvedStyleGuide || {},
    promptVersion,
  });

  if (isPreview) {
    return {
      ok: true,
      prompt: {
        system: promptPack.systemPrompt,
        user: JSON.stringify(promptPack.userPromptJson, null, 2),
      },
      title_suggestions: [],
      markdown: "",
      hashtags: [],
      quality_checks: {
        length_rule: false,
        emoji_rule: false,
        banned_phrases_ok: false,
        cta_included: false,
        tip_box_included: false,
        image_anchors_ok: false,
        image_plan_ok: false,
      },
      issues: [],
      llmMeta: null,
      image_plan: [],
    };
  }

  const expectedImagesMeta = promptPack.userPromptJson?.inputs?.imagesMeta || [];
  const anchorCorrective =
    expectedImagesMeta.length > 0
      ? "이미지 anchor가 누락/변형되었다. [사진 1]..[사진 N]을 정확한 형식으로 각각 1회만 포함하고 image_plan을 1:1로 맞춰 다시 JSON만 출력하라."
      : "이번 요청은 이미지가 없다. markdown에서 [사진 N] anchor를 모두 제거하고 image_plan은 []로 반환해 JSON만 출력하라.";

  const completion = await callLlmJson({
    providerConfig,
    systemPrompt: promptPack.systemPrompt,
    userPromptJson: promptPack.userPromptJson,
    outputSchema: promptPack.outputSchema,
    postValidate: (json) => {
      const imageCheck = validateImageAnchorsAndPlan({
        markdown: json?.markdown,
        imagePlan: json?.image_plan,
        imagesMeta: expectedImagesMeta,
      });
      return {
        ok: imageCheck.imageAnchorsOk && imageCheck.imagePlanOk,
        issues: imageCheck.issues,
      };
    },
    additionalCorrective: anchorCorrective,
  });

  const validated = validateOutput({
    json: completion.json,
    styleGuide: resolvedStyleGuide || {},
    constraints: {
      ...constraints,
      includeTipBox: Boolean(promptPack.userPromptJson?.content_options?.include_tip_box),
      imagesMeta: expectedImagesMeta,
    },
  });

  return {
    title_suggestions: validated.output.title_suggestions,
    markdown: validated.output.markdown,
    hashtags: validated.output.hashtags,
    image_plan: validated.output.image_plan,
    quality_checks: validated.output.quality_checks,
    issues: validated.issues,
    ok: validated.ok,
    prompt: {
      system: promptPack.systemPrompt,
      user: JSON.stringify(promptPack.userPromptJson, null, 2),
    },
    llmMeta: {
      provider: completion.provider,
      model: completion.model,
      rawText: completion.rawText,
      rawResponses: Array.isArray(completion.rawResponses) ? completion.rawResponses : [],
    },
  };
}

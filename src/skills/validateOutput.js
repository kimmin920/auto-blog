function includesAny(text, words) {
  const target = String(text || "").toLowerCase();
  return words.some((w) => target.includes(String(w || "").toLowerCase()));
}

function normalizeHashtags(tags) {
  if (!Array.isArray(tags)) return [];
  return [...new Set(tags.map((t) => String(t || "").trim()).filter(Boolean).map((t) => (t.startsWith("#") ? t : `#${t.replace(/\s+/g, "")}`)))];
}

function normalizeTitleSuggestions(titles) {
  if (!Array.isArray(titles)) return [];
  return [...new Set(
    titles
      .map((t) => String(t || "").replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .map((t) => t.replace(/^["'`]|["'`]$/g, ""))
  )].slice(0, 7);
}

export function validateImageAnchorsAndPlan({ markdown, imagePlan, imagesMeta }) {
  const text = String(markdown || "");
  const plan = Array.isArray(imagePlan) ? imagePlan : [];
  const images = Array.isArray(imagesMeta) ? imagesMeta : [];
  const expectedCount = images.length;
  const issues = [];
  const strictAnchorMatches = text.match(/\[사진 \d+\]/g) || [];
  const looseAnchorMatches = text.match(/\[사진\s*\d+\]/g) || [];

  let imageAnchorsOk = true;
  let imagePlanOk = true;

  if (expectedCount === 0) {
    const hasAnchors = looseAnchorMatches.length > 0;
    if (hasAnchors) {
      imageAnchorsOk = false;
      issues.push("anchors exist but imagesMeta is empty");
    }
    if (plan.length !== 0) {
      imagePlanOk = false;
      issues.push("image_plan must be empty when imagesMeta is empty");
    }
    return { imageAnchorsOk, imagePlanOk, issues };
  }

  if (strictAnchorMatches.length !== looseAnchorMatches.length) {
    imageAnchorsOk = false;
    issues.push("anchor format must be [사진 N] with a single space");
  }

  for (let i = 1; i <= expectedCount; i += 1) {
    const expectedAnchor = `[사진 ${i}]`;
    const escaped = expectedAnchor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const count = (text.match(new RegExp(escaped, "g")) || []).length;
    if (count === 0) {
      imageAnchorsOk = false;
      issues.push(`missing anchor: ${expectedAnchor}`);
    } else if (count > 1) {
      imageAnchorsOk = false;
      issues.push(`duplicate anchor: ${expectedAnchor} appears ${count} times`);
    }
  }

  for (const anchor of strictAnchorMatches) {
    const num = Number((anchor.match(/\d+/) || [0])[0]);
    if (!Number.isInteger(num) || num < 1 || num > expectedCount) {
      imageAnchorsOk = false;
      issues.push(`unexpected anchor index: ${anchor}`);
    }
  }

  if (plan.length !== expectedCount) {
    imagePlanOk = false;
    issues.push(`image_plan length mismatch: expected ${expectedCount}, got ${plan.length}`);
  }

  for (let i = 0; i < expectedCount; i += 1) {
    const item = plan[i] || {};
    const expectedSlot = `PHOTO_${i + 1}`;
    const expectedAnchor = `[사진 ${i + 1}]`;
    if (String(item.slot || "") !== expectedSlot) {
      imagePlanOk = false;
      issues.push(`image_plan[${i}].slot must be ${expectedSlot}`);
    }
    if (String(item.anchor || "") !== expectedAnchor) {
      imagePlanOk = false;
      issues.push(`image_plan[${i}].anchor must be ${expectedAnchor}`);
    }
  }

  return { imageAnchorsOk, imagePlanOk, issues };
}

export function validateOutput({ json, styleGuide = {}, constraints = {} }) {
  const markdown = String(json?.markdown || "").trim();
  const imagePlan = Array.isArray(json?.image_plan) ? json.image_plan : [];
  const imagesMeta = Array.isArray(constraints.imagesMeta) ? constraints.imagesMeta : [];
  const minChars = Number(constraints.minChars || styleGuide?.writing_rules?.length_policy?.min_chars || 600);
  const maxChars = Number(constraints.maxChars || styleGuide?.writing_rules?.length_policy?.max_chars || 4000);

  const banned = Array.isArray(styleGuide?.banned_phrases) ? styleGuide.banned_phrases : [];
  const lowered = markdown.toLowerCase();
  const bannedHit = banned.find((phrase) => phrase && lowered.includes(String(phrase).toLowerCase()));

  const includeTipBox = Boolean(constraints.includeTipBox ?? true);
  const tipIncluded = includeTipBox ? includesAny(markdown, ["tip", "✅ tip", "📌 정리", "tip & 체크", "정리"]) : true;
  const ctaIncluded = includesAny(markdown, ["댓글", "이웃", "궁금", "어때", "어떠", "질문"]);
  const emojiRule = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(markdown) || markdown.length > 1000;
  const lengthRule = markdown.length >= minChars && markdown.length <= maxChars;
  const imageValidation = validateImageAnchorsAndPlan({ markdown, imagePlan, imagesMeta });

  const qualityChecks = {
    length_rule: lengthRule,
    emoji_rule: emojiRule,
    banned_phrases_ok: !bannedHit,
    cta_included: ctaIncluded,
    tip_box_included: tipIncluded,
    image_anchors_ok: imageValidation.imageAnchorsOk,
    image_plan_ok: imageValidation.imagePlanOk,
  };

  const issues = [];
  if (!markdown) issues.push("markdown is empty");
  if (!lengthRule) issues.push(`markdown length out of range (${markdown.length})`);
  if (bannedHit) issues.push(`banned phrase detected: ${bannedHit}`);
  if (!ctaIncluded) issues.push("cta not included");
  if (!tipIncluded) issues.push("tip box not included");
  issues.push(...imageValidation.issues);

  return {
    ok: issues.length === 0,
    issues,
    qualityChecks,
    output: {
      title_suggestions: normalizeTitleSuggestions(json?.title_suggestions),
      markdown,
      hashtags: normalizeHashtags(json?.hashtags),
      image_plan: imagePlan,
      quality_checks: qualityChecks,
    },
  };
}

function sentenceSplit(text) {
  return String(text || "")
    .split(/[.!?\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function wordCount(text) {
  return String(text || "").split(/\s+/).filter(Boolean).length;
}

function averageSentenceLength(text) {
  const sentences = sentenceSplit(text);
  if (!sentences.length) return 0;

  const total = sentences.reduce((acc, s) => acc + s.split(/\s+/).filter(Boolean).length, 0);
  return total / sentences.length;
}

function emojiCount(text) {
  const matches = String(text || "").match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu);
  return matches?.length || 0;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function scoreToBand(score) {
  if (score >= 85) return "excellent";
  if (score >= 70) return "good";
  if (score >= 50) return "fair";
  return "weak";
}

export function evaluateDraftQuality({ draft, styleProfile, sourceItems = [] }) {
  const body = String(draft?.body || "");
  const draftWords = wordCount(body);
  const headingCount = (body.match(/^##\s+/gm) || []).length;
  const paragraphCount = body.split(/\n\n+/).filter((p) => p.trim()).length;

  const toneScore = (() => {
    if (!styleProfile) return 65;
    const sentences = sentenceSplit(body);
    if (!sentences.length) return 30;

    const yoCount = sentences.filter((s) => /요[.!?]?$/.test(s)).length;
    const endingYoRatio = yoCount / sentences.length;
    const target = Number(styleProfile.endingYoRatio || 0);
    const diff = Math.abs(endingYoRatio - target);
    return clamp(Math.round(100 - diff * 220), 20, 100);
  })();

  const sentenceLengthScore = (() => {
    if (!styleProfile) return 65;
    const avg = averageSentenceLength(body);
    const target = Number(styleProfile.avgSentenceLength || avg || 0);
    if (!avg || !target) return 50;
    const ratio = Math.abs(avg - target) / target;
    return clamp(Math.round(100 - ratio * 150), 20, 100);
  })();

  const termScore = (() => {
    const terms = Array.isArray(styleProfile?.contentKeywords) ? styleProfile.contentKeywords.slice(0, 8) : [];
    const blocked = new Set(
      Array.isArray(styleProfile?.llmStyle?.doNotImitateTopics)
        ? styleProfile.llmStyle.doNotImitateTopics.map((x) => String(x).toLowerCase())
        : []
    );
    const styleTerms = terms.filter((t) => !blocked.has(String(t).toLowerCase()));
    if (!styleTerms.length) return 65;

    const normalized = body.toLowerCase();
    const hits = styleTerms.filter((t) => normalized.includes(String(t).toLowerCase())).length;
    return clamp(Math.round((hits / styleTerms.length) * 100), 20, 100);
  })();

  const emojiScore = (() => {
    if (!styleProfile) return 70;
    const wc = Math.max(wordCount(body), 1);
    const per1000 = Math.round((emojiCount(body) / wc) * 1000);
    const target = Number(styleProfile.emojiPer1000Words || 0);
    const diff = Math.abs(per1000 - target);
    return clamp(100 - diff * 8, 30, 100);
  })();

  const styleSimilarity = Math.round(
    toneScore * 0.35 + sentenceLengthScore * 0.25 + termScore * 0.25 + emojiScore * 0.15
  );

  const structureScore = clamp(
    30 + (headingCount >= 2 ? 35 : headingCount * 15) + (paragraphCount >= 4 ? 35 : paragraphCount * 8),
    0,
    100
  );
  const structureSimilarityScore = (() => {
    const pattern = styleProfile?.paragraphPattern;
    if (!pattern) return 65;

    const targetParagraphs = Number(pattern.avgParagraphCount || 0);
    const targetHeadings = Number(pattern.avgHeadingCount || 0);
    if (!targetParagraphs && !targetHeadings) return 65;

    const paragraphPart = targetParagraphs
      ? clamp(Math.round(100 - (Math.abs(paragraphCount - targetParagraphs) / targetParagraphs) * 160), 20, 100)
      : 65;
    const headingPart = targetHeadings
      ? clamp(Math.round(100 - (Math.abs(headingCount - targetHeadings) / targetHeadings) * 140), 20, 100)
      : 65;
    return Math.round(paragraphPart * 0.6 + headingPart * 0.4);
  })();

  const completenessScore = (() => {
    const sourceCount = sourceItems.length;
    if (!sourceCount) return 50;

    const covered = sourceItems.filter((item) => {
      const title = String(item?.title || "").trim();
      if (!title) return false;
      return body.includes(title.slice(0, 12));
    }).length;

    const ratio = covered / sourceCount;
    return clamp(Math.round(40 + ratio * 60), 0, 100);
  })();

  const readabilityScore = (() => {
    const w = draftWords;
    if (w < 120) return 45;
    if (w > 1600) return 60;
    return 85;
  })();

  const qualityScore = Math.round(
    structureScore * 0.3 + completenessScore * 0.35 + readabilityScore * 0.35
  );

  const lengthSimilarityScore = (() => {
    const target = Number(styleProfile?.avgPostWordCount || draft?.targetWordCount || 0);
    if (!target || target < 100) return 65;
    const diffRatio = Math.abs(draftWords - target) / target;
    return clamp(Math.round(100 - diffRatio * 140), 20, 100);
  })();

  const suggestions = [];
  if (styleSimilarity < 75) {
    suggestions.push("사용자 말투와 유사도를 높이기 위해 문장 호흡과 종결 어미 패턴을 더 반영하세요.");
  }
  if (headingCount < 2) {
    suggestions.push("본문에 `##` 소제목을 2개 이상 넣어 구조를 명확히 하세요.");
  }
  if (paragraphCount < 4) {
    suggestions.push("문단을 더 세분화해서 읽기 흐름을 개선하세요.");
  }
  if (completenessScore < 70) {
    suggestions.push("선택된 소셜 포스트 핵심 포인트가 본문에 모두 반영되었는지 확인하세요.");
  }
  if (structureSimilarityScore < 75) {
    suggestions.push("사용자 블로그의 단락/소제목 패턴(도입-전개-요약)에 더 가깝게 구조를 맞추세요.");
  }
  if (lengthSimilarityScore < 75) {
    suggestions.push("블로그 원문 평균 길이와 더 가깝게 맞추기 위해 본문 분량을 조정하세요.");
  }

  return {
    styleSimilarity,
    qualityScore,
    styleBand: scoreToBand(styleSimilarity),
    qualityBand: scoreToBand(qualityScore),
    detail: {
      toneScore,
      sentenceLengthScore,
      termScore,
      emojiScore,
      structureScore,
      structureSimilarityScore,
      completenessScore,
      readabilityScore,
      lengthSimilarityScore,
      headingCount,
      paragraphCount,
      wordCount: draftWords,
    },
    suggestions,
  };
}

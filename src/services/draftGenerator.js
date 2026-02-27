function formatToneGuide(styleProfile) {
  if (!styleProfile) {
    return "톤 가이드 없음";
  }

  const voice = styleProfile.llmStyle?.voiceSummary || "분석 없음";

  return [
    `톤: ${styleProfile.tone}`,
    `문장 길이(평균): ${styleProfile.avgSentenceLength}단어`,
    `포스트 길이(평균): ${styleProfile.avgPostWordCount || 0}단어`,
    `문체 요약: ${voice}`,
    `이모지 사용량(1000단어당): ${styleProfile.emojiPer1000Words}`,
  ].join(" | ");
}

function normalizeParagraph(text) {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/([.!?])\s+/g, "$1\n\n");
}

function getTargetWordCount(styleProfile) {
  const raw = Number(
    styleProfile?.paragraphPattern?.recommendedWordCount || styleProfile?.avgPostWordCount || 900
  );
  return Math.max(450, Math.min(2200, raw));
}

function clampPattern(pattern = {}) {
  return {
    introParagraphs: Math.max(1, Math.min(3, Number(pattern.introParagraphs || 1))),
    bodyParagraphs: Math.max(2, Math.min(8, Number(pattern.bodyParagraphs || 3))),
    summaryParagraphs: Math.max(1, Math.min(3, Number(pattern.summaryParagraphs || 1))),
    headingTarget: Math.max(3, Math.min(8, Number(pattern.avgHeadingCount || 4))),
  };
}

function mediaGuide(item) {
  const mediaItems = Array.isArray(item?.mediaItems) ? item.mediaItems : [];
  if (!mediaItems.length) return "";

  const imageCount = mediaItems.filter((m) => (m?.type || "").toLowerCase() === "image").length;
  const videoCount = mediaItems.filter((m) => (m?.type || "").toLowerCase() === "video").length;
  const total = mediaItems.length;

  return `\n\n### 이미지/영상 포인트\n- 총 ${total}개 미디어\n- 이미지 ${imageCount}개 / 영상 ${videoCount}개`;
}

function splitSentences(text) {
  return String(text || "")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function buildParagraphsFromText(text, targetParagraphs = 3) {
  const sentences = splitSentences(text);
  if (!sentences.length) return [String(text || "").trim()].filter(Boolean);

  const chunks = [];
  const size = Math.max(1, Math.ceil(sentences.length / Math.max(1, targetParagraphs)));
  for (let i = 0; i < sentences.length; i += size) {
    chunks.push(sentences.slice(i, i + size).join(" ").trim());
  }

  return chunks.filter(Boolean);
}

function buildBody(instagramItems, styleProfile) {
  if (!instagramItems.length) {
    return "인스타그램 링크가 없어 기본 템플릿만 생성했어요.";
  }

  const targetWords = getTargetWordCount(styleProfile);
  const pattern = clampPattern(styleProfile?.paragraphPattern || {});
  const introParagraphs = pattern.introParagraphs;
  const bodyParagraphs = pattern.bodyParagraphs;
  const summaryParagraphs = pattern.summaryParagraphs;
  const headingTarget = pattern.headingTarget;

  const introSource = instagramItems
    .map((x) => x.title || "")
    .filter(Boolean)
    .slice(0, 3)
    .join(", ");
  const introParagraphText = introSource
    ? `이번 글은 ${introSource} 내용을 한 번에 이해할 수 있도록 정리했습니다.`
    : "이번 글은 최근 공유한 콘텐츠 핵심을 빠르게 이해할 수 있도록 정리했습니다.";
  const introParagraphBlocks = buildParagraphsFromText(
    `${introParagraphText} 검색 관점에서 핵심 키워드와 실제 포인트를 함께 다룹니다.`,
    introParagraphs
  );
  const intro = [
    "## 핵심 요약",
    ...introParagraphBlocks,
  ].join("\n\n");

  const sections = instagramItems
    .map((item, index) => {
      const heading = `## 포인트 ${index + 1}: ${item.title || "제목 없음"}`;
      const desc = item.description || item.excerpt || "설명 텍스트를 찾지 못했어요.";
      const image = item.image ? "\n대표 이미지가 포함된 포스트입니다." : "";
      const imageByImage = mediaGuide(item);
      const bodyBlocks = buildParagraphsFromText(normalizeParagraph(desc), bodyParagraphs);
      return `${heading}\n\n${bodyBlocks.join("\n\n")}${image}${imageByImage}`;
    })
    .join("\n\n");

  const cta = [
    "## 마무리",
    "이번 글의 핵심 포인트를 기준으로 다음 글도 실전 중심으로 이어가겠습니다.",
    `(목표 길이 가이드: 약 ${targetWords}단어)`,
    `(문단 패턴 가이드: 도입 ${introParagraphs} / 전개 ${bodyParagraphs} / 요약 ${summaryParagraphs}, 소제목 약 ${headingTarget}개)`,
  ].join("\n\n");

  return `${intro}\n\n${sections}\n\n${cta}`;
}

export function buildDraftOutput({ userId, title, toneGuide, body, hashtags, meta = {} }) {
  const plainText = `${title}\n\n${body}\n\n${hashtags.join(" ")}`;

  const html = [
    `<h1>${title}</h1>`,
    `<p><strong>작성 가이드:</strong> ${toneGuide}</p>`,
    ...body.split("\n\n").map((p) => `<p>${p}</p>`),
    `<p>${hashtags.join(" ")}</p>`,
  ].join("\n");

  return {
    userId,
    title,
    toneGuide,
    body,
    hashtags,
    plainText,
    html,
    createdAt: new Date().toISOString(),
    ...meta,
  };
}

export function generateDraft({ userId, styleProfile, instagramItems }) {
  const titleBase = instagramItems[0]?.title || "인스타그램 콘텐츠";
  const title = `[자동초안] ${titleBase} 완전 정리 (핵심 포인트 + FAQ)`;
  const toneGuide = formatToneGuide(styleProfile);
  const body = buildBody(instagramItems, styleProfile);
  const targetWordCount = getTargetWordCount(styleProfile);

  const hashtags = [
    "#블로그자동화",
    "#콘텐츠재가공",
  ];

  return buildDraftOutput({
    userId,
    title,
    toneGuide,
    body,
    hashtags,
    meta: {
      llmApplied: false,
      targetWordCount,
    },
  });
}

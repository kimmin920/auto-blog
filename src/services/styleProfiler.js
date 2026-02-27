function sentenceSplit(text) {
  return text
    .split(/[.!?\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function countEmoji(text) {
  const matches = text.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu);
  return matches?.length || 0;
}

function getContentKeywords(text, limit = 12) {
  const cleaned = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  const ignore = new Set([
    "그리고",
    "하지만",
    "그래서",
    "정말",
    "너무",
    "오늘",
    "이건",
    "that",
    "with",
    "from",
    "have",
    "this",
    "there",
  ]);

  const counts = new Map();
  for (const word of cleaned.split(" ")) {
    if (!word || word.length < 2 || ignore.has(word)) continue;
    counts.set(word, (counts.get(word) || 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([word]) => word);
}

function getTone(sentences) {
  if (!sentences.length) {
    return { formality: "중립", endingYoRatio: 0 };
  }

  const yoCount = sentences.filter((s) => /요[.!?]?$/.test(s)).length;
  const daCount = sentences.filter((s) => /다[.!?]?$/.test(s)).length;
  const endingYoRatio = yoCount / sentences.length;

  if (endingYoRatio > 0.5) {
    return { formality: "친절한 존댓말", endingYoRatio };
  }

  if (daCount / sentences.length > 0.5) {
    return { formality: "설명형 문어체", endingYoRatio };
  }

  return { formality: "혼합", endingYoRatio };
}

function collectWritingSamples(pages, maxSamples = 10) {
  const samples = [];

  for (const page of pages) {
    const raw = String(page?.text || "").replace(/\r/g, "").trim();
    if (!raw) continue;

    const paragraphs = raw
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter(Boolean);
    const merged = paragraphs.length ? paragraphs.slice(0, 6).join("\n\n") : raw;
    const normalized = merged.replace(/\n{3,}/g, "\n\n").trim();

    if (normalized.length > 120) {
      samples.push(normalized.slice(0, 1400));
    }
    if (samples.length >= maxSamples) break;
  }

  return samples;
}

function average(nums, fallback = 0) {
  if (!nums.length) return fallback;
  return nums.reduce((acc, n) => acc + n, 0) / nums.length;
}

function buildParagraphPattern(pages, avgPostWordCount) {
  const paragraphCounts = pages
    .map((p) => Number(p?.structureHints?.paragraphCount || 0))
    .filter((n) => n > 0);
  const headingCounts = pages
    .map((p) => Number(p?.structureHints?.headingCount || 0))
    .filter((n) => n >= 0);
  const sentenceCounts = pages
    .map((p) => Number(p?.structureHints?.sentenceCount || 0))
    .filter((n) => n > 0);

  const avgParagraphCount = Math.max(3, Math.min(12, Math.round(average(paragraphCounts, 6))));
  const avgHeadingCount = Math.max(1, Math.min(6, Math.round(average(headingCounts, 2))));
  const avgSentenceCount = Math.max(10, Math.round(average(sentenceCounts, 18)));

  const introParagraphs = Math.max(1, Math.min(3, Math.round(avgParagraphCount * 0.18)));
  const summaryParagraphs = Math.max(1, Math.min(3, Math.round(avgParagraphCount * 0.2)));
  const bodyParagraphs = Math.max(2, Math.min(8, avgParagraphCount - introParagraphs - summaryParagraphs));

  const introSentences = Math.max(2, Math.round(avgSentenceCount * 0.2));
  const summarySentences = Math.max(2, Math.round(avgSentenceCount * 0.2));
  const bodySentences = Math.max(6, avgSentenceCount - introSentences - summarySentences);

  return {
    avgParagraphCount,
    avgHeadingCount,
    introParagraphs,
    bodyParagraphs,
    summaryParagraphs,
    introSentences,
    bodySentences,
    summarySentences,
    recommendedWordCount: Math.max(450, Math.min(2200, Number(avgPostWordCount || 900))),
  };
}

export function buildStyleProfile(pages) {
  const textBlob = pages.map((p) => p.text).join(" ");
  const sentences = sentenceSplit(textBlob);
  const wordCount = textBlob.split(/\s+/).filter(Boolean).length;
  const postWordCounts = pages.map((p) => String(p.text || "").split(/\s+/).filter(Boolean).length);
  const avgPostWordCount = postWordCounts.length
    ? Math.round(postWordCounts.reduce((acc, n) => acc + n, 0) / postWordCounts.length)
    : 0;
  const minPostWordCount = postWordCounts.length ? Math.min(...postWordCounts) : 0;
  const maxPostWordCount = postWordCounts.length ? Math.max(...postWordCounts) : 0;

  const avgSentenceLength = sentences.length
    ? Math.round(
        sentences.reduce((acc, cur) => acc + cur.split(/\s+/).filter(Boolean).length, 0) /
          sentences.length
      )
    : 0;

  const emojiCount = countEmoji(textBlob);
  const emojiPer1000Words = wordCount ? Math.round((emojiCount / wordCount) * 1000) : 0;
  const tone = getTone(sentences);
  const paragraphPattern = buildParagraphPattern(pages, avgPostWordCount);

  return {
    sourceCount: pages.length,
    wordCount,
    avgPostWordCount,
    minPostWordCount,
    maxPostWordCount,
    avgSentenceLength,
    tone: tone.formality,
    endingYoRatio: Number(tone.endingYoRatio.toFixed(2)),
    emojiPer1000Words,
    contentKeywords: getContentKeywords(textBlob),
    writingSamples: collectWritingSamples(pages),
    paragraphPattern,
    spellingTolerance: {
      enabled: false,
      allowedPatterns: [],
    },
  };
}

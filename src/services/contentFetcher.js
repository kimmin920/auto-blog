import { decodeHtmlEntities } from "../utils/html.js";

function stripHtml(html) {
  const stripped = String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|blockquote|h[1-6]|section|article)>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  return decodeHtmlEntities(stripped);
}

const NOISE_LINE_PATTERNS = [
  /네이버\s*블로그/i,
  /naver\s*블로그/i,
  /블로그\s*검색/i,
  /이\s*블로그에서\s*검색/i,
  /공감\s*\d+/i,
  /칭찬\s*\d+/i,
  /감사\s*\d+/i,
  /웃김\s*\d+/i,
  /놀람\s*\d+/i,
  /슬픔\s*\d+/i,
  /댓글\s*\d+/i,
  /공유하기/i,
  /블로그\s*주소\s*변경\s*불가\s*안내/i,
  /블로그\s*아이디가\s*필요해요/i,
  /레이어\s*닫기/i,
  /자세히\s*보기/i,
  /span\.\s*u_likeit_button/i,
  /face\s*\d+\s*개/i,
];

function isNoiseLine(line) {
  const text = String(line || "").trim();
  if (!text) return true;
  if (text.length < 2) return true;
  if (NOISE_LINE_PATTERNS.some((rx) => rx.test(text))) return true;
  if (/^(공감|댓글|공유|좋아요|좋아요 수)$/i.test(text)) return true;
  return false;
}

function cleanExtractedText(text, title = "") {
  const lines = String(text || "")
    .split(/\n+/)
    .map((line) => decodeHtmlEntities(line).replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((line) => !isNoiseLine(line));

  const deduped = [];
  for (const line of lines) {
    if (deduped[deduped.length - 1] === line) continue;
    deduped.push(line);
  }

  const body = deduped.join("\n").trim();
  if (!title) return body;

  const cleanTitle = String(title).trim();
  return body
    .replace(new RegExp(`^${cleanTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*`, "i"), "")
    .trim();
}

function extractBalancedDiv(html, startIndex) {
  const openTag = /<div\b[^>]*>/gi;
  openTag.lastIndex = startIndex;
  const first = openTag.exec(html);
  if (!first || first.index !== startIndex) return "";

  const divTag = /<\/?div\b[^>]*>/gi;
  divTag.lastIndex = startIndex;
  let depth = 0;
  let endIndex = -1;
  let match;

  while ((match = divTag.exec(html)) !== null) {
    const token = match[0];
    if (/^<div\b/i.test(token)) {
      depth += 1;
    } else {
      depth -= 1;
      if (depth === 0) {
        endIndex = divTag.lastIndex;
        break;
      }
    }
  }

  return endIndex > startIndex ? html.slice(startIndex, endIndex) : "";
}

function extractByDivClass(html, classPattern) {
  const rx = new RegExp(
    `<div[^>]*class=["'][^"']*(?:${classPattern})[^"']*["'][^>]*>`,
    "gi"
  );
  const candidates = [];
  let match;

  while ((match = rx.exec(html)) !== null) {
    const block = extractBalancedDiv(html, match.index);
    if (block) candidates.push(block);
  }

  return candidates;
}

function extractLdJsonArticleBody(html) {
  const ldRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const out = [];
  let match;

  while ((match = ldRegex.exec(html)) !== null) {
    const raw = match?.[1]?.trim();
    if (!raw) continue;

    try {
      const data = JSON.parse(raw);
      const nodes = Array.isArray(data) ? data : [data];
      for (const node of nodes) {
        const articleBody = node?.articleBody;
        if (typeof articleBody === "string" && articleBody.trim().length > 120) {
          out.push(articleBody.trim());
        }
      }
    } catch {
      continue;
    }
  }

  return out;
}

function removeAdBottomPortal(html) {
  let modified = html;
  for (let i = 0; i < 5; i++) {
    const match = /<div[^>]*id=["']ad-bottom-portal["'][^>]*>/i.exec(modified);
    if (!match) break;
    const block = extractBalancedDiv(modified, match.index);
    if (block) {
      modified = modified.slice(0, match.index) + " " + modified.slice(match.index + block.length);
    } else {
      break;
    }
  }
  return modified;
}

function removeDivBlocksByClass(html, classPattern, maxIterations = 80) {
  let modified = String(html || "");
  const rx = new RegExp(
    `<div[^>]*class=["'][^"']*(?:${classPattern})[^"']*["'][^>]*>`,
    "i"
  );

  for (let i = 0; i < maxIterations; i += 1) {
    const match = rx.exec(modified);
    if (!match) break;

    const block = extractBalancedDiv(modified, match.index);
    if (block) {
      modified = `${modified.slice(0, match.index)} ${modified.slice(match.index + block.length)}`;
      continue;
    }

    // Fallback: if balancing failed, at least remove the opening tag.
    modified = `${modified.slice(0, match.index)} ${modified.slice(match.index + match[0].length)}`;
  }

  return modified;
}

function removeNaverOglinkModules(html) {
  // Exclude Naver external-link preview blocks from "author-written" text.
  return removeDivBlocksByClass(html, "se-module-oglink");
}

function extractMainTextFromHtml(html, title = "") {
  html = removeAdBottomPortal(html);
  html = removeNaverOglinkModules(html);

  // 1. Highest Priority for Naver Blogs: se-main-container
  const mainContainers = extractByDivClass(html, "se-main-container");
  if (mainContainers.length) {
    const cleaned = cleanExtractedText(stripHtml(mainContainers.join("\n")), title);
    if (cleaned.length > 50) return cleaned;
  }

  // 2. Fallback to LD JSON metadata
  const ldBodies = extractLdJsonArticleBody(html).map((text) => cleanExtractedText(text, title));
  const ldBest = ldBodies.sort((a, b) => b.length - a.length)[0];
  if (ldBest && ldBest.length > 200) return ldBest;

  // 3. General fallbacks
  const classPatterns = [
    "se_component_wrap",
    "post-view",
    "post-view-area",
    "post_ct",
    "post_body",
    "post-body",
    "entry-content",
    "article[_-]?body",
    "article[_-]?content",
    "tt_article_useless_p_margin",
  ];

  const blocks = classPatterns.flatMap((pattern) => extractByDivClass(html, pattern));
  const cleanedCandidates = blocks
    .map((block) => cleanExtractedText(stripHtml(block), title))
    .filter((text) => text.length > 120)
    .sort((a, b) => b.length - a.length);

  if (cleanedCandidates.length) return cleanedCandidates[0];
  return cleanExtractedText(stripHtml(html), title);
}

function extractStructureHints(html, text) {
  const normalizedText = String(text || "").replace(/\r/g, "").trim();
  const paragraphCount = normalizedText
    ? normalizedText
      .split(/\n{2,}/)
      .map((s) => s.trim())
      .filter(Boolean).length
    : 0;
  const headingCount = normalizedText
    ? normalizedText
      .split(/\n+/)
      .map((s) => s.trim())
      .filter((line) => /^#{1,4}\s+/.test(line) || /^(\[.*\]|.+:)$/.test(line)).length
    : 0;
  const sentenceCount = normalizedText
    .split(/[.!?\n]+/)
    .map((s) => s.trim())
    .filter(Boolean).length;
  const wordCount = normalizedText.split(/\s+/).filter(Boolean).length;

  return {
    paragraphCount: Math.max(1, Math.min(paragraphCount || 1, 24)),
    headingCount: Math.max(0, Math.min(headingCount || 0, 12)),
    sentenceCount,
    wordCount,
  };
}

function findMeta(html, key, attr = "property") {
  const regex = new RegExp(`<meta[^>]*${attr}=["']${key}["'][^>]*content=["']([^"']+)["'][^>]*>`, "i");
  const match = html.match(regex);
  return decodeHtmlEntities(match?.[1]?.trim() || "");
}

function findTitle(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return decodeHtmlEntities(match?.[1]?.replace(/\s+/g, " ").trim() || "");
}

function cleanBlogTitle(title) {
  return String(title || "")
    .replace(/\s*[:|\-]\s*네이버\s*블로그.*$/i, "")
    .replace(/\s*-\s*NAVER\s*Blog.*$/i, "")
    .replace(/\s*:\s*NAVER\s*BLOG.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function pickExcerpt(text, max = 700) {
  if (!text) return "";
  const clean = decodeHtmlEntities(text);
  return clean.length <= max ? clean : `${clean.slice(0, max).trim()}...`;
}

function findMainFrameUrl(html, baseUrl) {
  const iframeMatch = html.match(
    /<iframe[^>]*id=["'](?:mainFrame|postViewAreaFrame)["'][^>]*src=["']([^"']+)["'][^>]*>/i
  );
  const src = iframeMatch?.[1] || "";
  if (!src) return "";
  try {
    return new URL(src, baseUrl).toString();
  } catch {
    return "";
  }
}

function cleanupUrl(raw) {
  if (!raw) return "";
  const decoded = decodeHtmlEntities(String(raw))
    .replace(/\\u0026/g, "&")
    .replace(/\\u0025/g, "%")
    .replace(/\\\//g, "/")
    .replace(/^"|"$/g, "")
    .trim();

  return /^https?:\/\//i.test(decoded) ? decoded : "";
}

function inferMediaType(url) {
  const lower = url.toLowerCase();
  if (lower.includes(".mp4") || lower.includes("/video")) return "video";
  if (lower.includes(".jpg") || lower.includes(".jpeg") || lower.includes(".png") || lower.includes(".webp")) return "image";
  return "unknown";
}

function addMedia(map, url, forcedType = "") {
  const cleanUrl = cleanupUrl(url);
  if (!cleanUrl || map.has(cleanUrl) || map.size >= 80) return;

  map.set(cleanUrl, {
    type: forcedType || inferMediaType(cleanUrl),
    url: cleanUrl,
  });
}

function extractLdJsonMedia(html, mediaMap) {
  const ldRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

  let match;
  while ((match = ldRegex.exec(html)) !== null) {
    const raw = match?.[1]?.trim();
    if (!raw) continue;

    try {
      const data = JSON.parse(raw);
      const nodes = Array.isArray(data) ? data : [data];

      for (const node of nodes) {
        const image = node?.image;
        if (Array.isArray(image)) {
          for (const imageUrl of image) addMedia(mediaMap, imageUrl, "image");
        } else {
          addMedia(mediaMap, image, "image");
        }

        addMedia(mediaMap, node?.thumbnailUrl, "image");
        addMedia(mediaMap, node?.contentUrl, "video");
      }
    } catch {
      continue;
    }
  }
}

function typeByContext(path) {
  const context = path.join(".").toLowerCase();
  if (context.includes("video_versions") || context.includes("video_url")) return "video";
  if (
    context.includes("image_versions2") ||
    context.includes("display_resources") ||
    context.includes("thumbnail_resources") ||
    context.includes("carousel_media") ||
    context.includes("thumbnail")
  ) {
    return "image";
  }
  return "";
}

function collectMediaFromJsonNode(node, mediaMap, path = []) {
  if (node == null) return;

  if (typeof node === "string") {
    const forcedType = typeByContext(path);
    addMedia(mediaMap, node, forcedType);
    return;
  }

  if (Array.isArray(node)) {
    for (const item of node) {
      collectMediaFromJsonNode(item, mediaMap, path);
    }
    return;
  }

  if (typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      const nextPath = [...path, key];

      if (typeof value === "string") {
        if (
          key === "display_url" ||
          key === "thumbnail_src" ||
          key === "thumbnailUrl" ||
          key === "thumbnail_url" ||
          key === "src" ||
          key === "contentUrl" ||
          key === "url" ||
          key === "video_url"
        ) {
          const forcedType = key === "video_url" ? "video" : typeByContext(nextPath);
          addMedia(mediaMap, value, forcedType);
        }
      }

      collectMediaFromJsonNode(value, mediaMap, nextPath);
    }
  }
}

function extractJsonScriptMedia(html, mediaMap) {
  const scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi;

  let match;
  while ((match = scriptRegex.exec(html)) !== null) {
    const body = match?.[1]?.trim();
    if (!body) continue;

    if (body.startsWith("{") || body.startsWith("[")) {
      try {
        const parsed = JSON.parse(body);
        collectMediaFromJsonNode(parsed, mediaMap);
      } catch {
        // ignore parse errors for non-JSON scripts
      }
    }
  }
}

function extractRegexMedia(html, mediaMap) {
  const patterns = [
    /"display_url"\s*:\s*"(https?:[^\"]+)"/g,
    /"thumbnail_src"\s*:\s*"(https?:[^\"]+)"/g,
    /"thumbnail_url"\s*:\s*"(https?:[^\"]+)"/g,
    /"video_url"\s*:\s*"(https?:[^\"]+)"/g,
    /"contentUrl"\s*:\s*"(https?:[^\"]+)"/g,
    /"src"\s*:\s*"(https?:[^\"]+cdninstagram[^\"]+)"/g,
    /"(?:display_url|thumbnail_src|thumbnail_url|video_url|contentUrl|url)"\s*:\s*"(https?:\\\/\\\/[^\"]+)"/g,
    /"(https?:\\\/\\\/[^"]*cdninstagram[^"]*)"/g,
  ];

  for (const pattern of patterns) {
    let m;
    while ((m = pattern.exec(html)) !== null) {
      const value = m[1];
      const forcedType =
        pattern.source.includes("video_url") || pattern.source.includes("contentUrl")
          ? "video"
          : "";
      addMedia(mediaMap, value, forcedType);
    }
  }
}

function extractMedia(html) {
  const mediaMap = new Map();

  addMedia(mediaMap, findMeta(html, "og:image"), "image");
  addMedia(mediaMap, findMeta(html, "og:video"), "video");
  addMedia(mediaMap, findMeta(html, "og:video:url"), "video");
  addMedia(mediaMap, findMeta(html, "twitter:image"), "image");

  extractLdJsonMedia(html, mediaMap);
  extractJsonScriptMedia(html, mediaMap);
  extractRegexMedia(html, mediaMap);

  return [...mediaMap.values()];
}

export async function fetchPage(url, depth = 0) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; BlogAutoMVP/0.1)",
    },
  });

  if (!res.ok) {
    throw new Error(`Fetch failed (${res.status})`);
  }

  let html = await res.text();
  let title = cleanBlogTitle(findMeta(html, "og:title") || findTitle(html));
  let text = extractMainTextFromHtml(html, title);

  // Naver desktop pages often keep the real post body inside #mainFrame.
  if (depth === 0 && /blog\.naver\.com/i.test(url) && text.length < 220) {
    const frameUrl = findMainFrameUrl(html, url);
    if (frameUrl) {
      try {
        const frameRes = await fetch(frameUrl, {
          headers: { "user-agent": "Mozilla/5.0 (compatible; BlogAutoMVP/0.1)" },
        });
        if (frameRes.ok) {
          html = await frameRes.text();
          title = cleanBlogTitle(findMeta(html, "og:title") || findTitle(html) || title);
          text = extractMainTextFromHtml(html, title);
        }
      } catch {
        // keep fallback from outer page
      }
    }
  }

  const mediaItems = extractMedia(html);
  const structureHints = extractStructureHints(html, text);

  return {
    url,
    title,
    description: findMeta(html, "og:description") || pickExcerpt(text, 280),
    image: decodeHtmlEntities(findMeta(html, "og:image")),
    mediaItems,
    structureHints,
    text,
    excerpt: pickExcerpt(text),
  };
}

export async function fetchMany(urls) {
  const results = await Promise.all(
    urls.map(async (url) => {
      try {
        const page = await fetchPage(url);
        return { ok: true, data: page };
      } catch (error) {
        return {
          ok: false,
          data: {
            url,
            error: error instanceof Error ? error.message : "Unknown error",
          },
        };
      }
    })
  );

  return results;
}

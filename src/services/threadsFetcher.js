function toInt(value, fallback) {
  const n = Number.parseInt(String(value ?? ""), 10);
  return Number.isNaN(n) ? fallback : n;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function firstSentence(text) {
  if (!text) return "";
  const line = text.split(/\n|\./)[0]?.trim() || "";
  return line.length <= 80 ? line : `${line.slice(0, 80)}...`;
}

function addMedia(map, type, url) {
  const clean = String(url || "").trim();
  if (!clean || !/^https?:\/\//i.test(clean) || map.has(clean)) return;
  map.set(clean, { type: type || "unknown", url: clean });
}

function normalizeThreadPost(post) {
  const mediaMap = new Map();

  addMedia(mediaMap, post.media_type === "VIDEO" ? "video" : "image", post.media_url);
  addMedia(mediaMap, "image", post.thumbnail_url);

  if (Array.isArray(post.children?.data)) {
    for (const child of post.children.data) {
      addMedia(mediaMap, child.media_type === "VIDEO" ? "video" : "image", child.media_url);
      addMedia(mediaMap, "image", child.thumbnail_url);
    }
  }

  const text = String(post.text || "").trim();
  const title = firstSentence(text) || `Threads Post ${post.id || ""}`.trim();
  const permalink = post.permalink || "";

  return {
    platform: "threads",
    id: post.id || "",
    url: permalink,
    title,
    description: text,
    excerpt: text.length > 280 ? `${text.slice(0, 280)}...` : text,
    image: post.thumbnail_url || post.media_url || "",
    mediaItems: [...mediaMap.values()],
    timestamp: post.timestamp || "",
  };
}

export async function fetchThreadsPosts({ accessToken, limit = 10, baseUrl }) {
  const token = String(accessToken || "").trim();
  if (!token) {
    throw new Error("threads access token is required");
  }

  const safeLimit = clamp(toInt(limit, 10), 1, 30);
  const apiBase = (baseUrl || process.env.THREADS_API_BASE || "https://graph.threads.net/v1.0").replace(/\/$/, "");
  const fields = [
    "id",
    "text",
    "media_type",
    "media_url",
    "thumbnail_url",
    "permalink",
    "timestamp",
    "shortcode",
    "children{media_type,media_url,thumbnail_url,permalink,id}",
  ].join(",");

  const endpoint = `${apiBase}/me/threads?fields=${encodeURIComponent(fields)}&limit=${safeLimit}&access_token=${encodeURIComponent(token)}`;

  const res = await fetch(endpoint, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; BlogAutoMVP/0.1)",
      accept: "application/json",
    },
  });

  const json = await res.json().catch(() => ({}));

  if (!res.ok || json?.error) {
    const message = json?.error?.message || `Threads API error (${res.status})`;
    throw new Error(message);
  }

  const posts = Array.isArray(json?.data) ? json.data : [];
  return posts.map(normalizeThreadPost);
}

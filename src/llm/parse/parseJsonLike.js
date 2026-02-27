import { extractFencedJson } from "./fencedJson.js";

export function parseJsonLike(input) {
  const raw = String(input || "").trim();
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    // continue
  }

  const fenced = extractFencedJson(raw);
  if (fenced) {
    try {
      return JSON.parse(fenced);
    } catch {
      // continue
    }
  }

  const start = raw.indexOf("{");
  if (start >= 0) {
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < raw.length; i += 1) {
      const ch = raw[i];

      if (escaped) {
        escaped = false;
        continue;
      }

      if (ch === "\\") {
        escaped = true;
        continue;
      }

      if (ch === '"') {
        inString = !inString;
        continue;
      }

      if (inString) continue;

      if (ch === "{") depth += 1;
      if (ch === "}") depth -= 1;

      if (depth === 0) {
        try {
          return JSON.parse(raw.slice(start, i + 1));
        } catch {
          break;
        }
      }
    }
  }

  return null;
}

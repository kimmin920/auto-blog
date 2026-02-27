export function extractFencedJson(text) {
  const raw = String(text || "");
  const matched = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return matched?.[1] ? matched[1].trim() : "";
}

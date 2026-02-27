import { parseJsonLike } from "./parseJsonLike.js";

export function repairJsonCompletion(rawText, outputSchema = null) {
  const parsed = parseJsonLike(rawText);
  if (parsed) return parsed;

  const text = String(rawText || "");
  const markdownSchemaHint = outputSchema && typeof outputSchema === "object" && "markdown" in outputSchema;

  if (markdownSchemaHint) {
    const stripped = text.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
    const hashtags = [...new Set(stripped.match(/#[\p{L}\p{N}_-]+/gu) || [])];
    if (stripped) {
      return {
        markdown: stripped,
        hashtags,
        quality_checks: {
          length_rule: false,
          emoji_rule: false,
          banned_phrases_ok: false,
          cta_included: false,
          tip_box_included: false,
        },
      };
    }
  }

  return null;
}

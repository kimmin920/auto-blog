import { normalizeStructuredInfo, normalizeImagesMeta } from "../services/utils.js";

function normalizeKeywords(keywords) {
  if (Array.isArray(keywords)) {
    return keywords.map((k) => String(k || "").trim()).filter(Boolean);
  }
  if (typeof keywords === "string") {
    return keywords
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
  }
  return [];
}

export function normalizeInputs({ blogType, keywords, title, structuredInfo, imagesMeta, persona: rawPersona }) {
  const persona = rawPersona && typeof rawPersona === "object"
    ? {
      identity: String(rawPersona.identity || "").trim(),
      blog_focus: String(rawPersona.blog_focus || "").trim(),
      target_reader: String(rawPersona.target_reader || "").trim(),
      goal: String(rawPersona.goal || "").trim(),
      tone_note: String(rawPersona.tone_note || "").trim(),
    }
    : {
      identity: "",
      blog_focus: "",
      target_reader: "",
      goal: "",
      tone_note: "",
    };
  return {
    blogType: String(blogType || "info").trim() || "info",
    keywords: normalizeKeywords(keywords),
    title: String(title || "").trim(),
    structuredInfo: normalizeStructuredInfo(structuredInfo),
    imagesMeta: normalizeImagesMeta(imagesMeta),
    persona,
  };
}

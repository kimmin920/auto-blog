function compactText(s, max = 140) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

export function recoverUserSamples(samples) {
  if (!Array.isArray(samples)) return [];

  const objLike = samples.filter((x) => x && typeof x === "object" && !Array.isArray(x));
  if (objLike.length > 0) {
    return objLike
      .map((s, idx) => ({
        source_url: String(s.source_url || s.url || `sample_${idx}`).trim(),
        excerpt: compactText(s.excerpt, 120),
        why_it_matters: compactText(s.why_it_matters, 200) || "문체 샘플",
      }))
      .filter((s) => s.excerpt);
  }

  const strings = samples.filter((x) => typeof x === "string").map((x) => x.trim()).filter(Boolean);
  const recovered = [];
  let buffer = [];
  let inObj = false;

  const flush = () => {
    if (!buffer.length) return;

    const joined = buffer.join("");
    buffer = [];
    inObj = false;

    const start = joined.indexOf("{");
    const end = joined.lastIndexOf("}");
    if (start < 0 || end <= start) return;

    try {
      const parsed = JSON.parse(joined.slice(start, end + 1));
      const item = {
        source_url: String(parsed.source_url || parsed.url || `sample_${recovered.length}`).trim(),
        excerpt: compactText(parsed.excerpt, 120),
        why_it_matters: compactText(parsed.why_it_matters, 200) || "문체 샘플",
      };
      if (item.excerpt) recovered.push(item);
    } catch {
      // ignore parse failures
    }
  };

  for (const token of strings) {
    if (!inObj && token.includes("{")) inObj = true;
    if (inObj) buffer.push(token);
    if (inObj && token.includes("}")) flush();
  }
  flush();

  if (recovered.length > 0) return recovered;

  return strings
    .map((token, idx) => ({
      source_url: `sample_${idx}`,
      excerpt: compactText(token, 120),
      why_it_matters: "문체 샘플(원문 조각)",
    }))
    .filter((s) => s.excerpt);
}

const namedEntities = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeOnce(input) {
  const text = String(input ?? "");

  return text
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = Number.parseInt(dec, 10);
      if (Number.isNaN(code)) return _;
      return String.fromCodePoint(code);
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      const code = Number.parseInt(hex, 16);
      if (Number.isNaN(code)) return _;
      return String.fromCodePoint(code);
    })
    .replace(/&([a-zA-Z]+);/g, (_, name) => namedEntities[name] ?? _);
}

export function decodeHtmlEntities(input) {
  let out = String(input ?? "");

  // Some sources are double-encoded, so decode repeatedly until stable.
  for (let i = 0; i < 3; i += 1) {
    const next = decodeOnce(out);
    if (next === out) break;
    out = next;
  }

  return out;
}

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

function stripQuotes(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;

  const normalized = trimmed.startsWith("export ")
    ? trimmed.slice("export ".length).trim()
    : trimmed;

  const idx = normalized.indexOf("=");
  if (idx <= 0) return null;

  const key = normalized.slice(0, idx).trim();
  if (!key) return null;

  const rawValue = normalized.slice(idx + 1).trim();
  return [key, stripQuotes(rawValue)];
}

const envPath = path.resolve(process.cwd(), ".env");

if (existsSync(envPath)) {
  const text = readFileSync(envPath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const parsed = parseEnvLine(line);
    if (!parsed) continue;

    const [key, value] = parsed;
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

import { readFile } from "node:fs/promises";
import path from "node:path";

const promptCache = new Map();

function resolvePromptPath(inputPath) {
  const raw = String(inputPath || "").trim();
  if (!raw) throw new Error("Prompt path is required");
  return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
}

export async function loadPrompt(promptPath) {
  const absPath = resolvePromptPath(promptPath);
  if (promptCache.has(absPath)) {
    return promptCache.get(absPath);
  }

  const content = await readFile(absPath, "utf8");
  const normalized = String(content || "").replace(/\r/g, "").trim();
  promptCache.set(absPath, normalized);
  return normalized;
}

export function clearPromptCache() {
  promptCache.clear();
}

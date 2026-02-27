import { inferStyleGuide } from "../skills/inferStyleGuide.js";

export async function runStyleInferencePipeline({ posts, providerConfig = {} }) {
  return inferStyleGuide({ posts, providerConfig });
}

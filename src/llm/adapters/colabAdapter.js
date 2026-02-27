export async function callColabAdapter({ providerConfig = {}, messages }) {
  const base = String(providerConfig.colabAddress || process.env.COLAB_ADDRESS || "").trim();
  if (!base) throw new Error("Colab Address is missing");

  const endpoint = base.endsWith("/generate") ? base : `${base.replace(/\/+$/, "")}/generate`;
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const user = messages.filter((m) => m.role !== "system").map((m) => m.content).join("\n\n");

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: `${system}\n\n${user}`,
      max_new_tokens: Number(providerConfig.maxTokens ?? 1600),
      temperature: Number(providerConfig.temperature ?? 0.7),
    }),
  });

  if (!response.ok) {
    throw new Error(`Colab endpoint failed: ${response.status} ${response.statusText}`);
  }

  const text = await response.text();
  try {
    const json = JSON.parse(text);
    return {
      rawText: String(json.response || json.text || text || "").trim(),
      model: "google-colab",
      provider: "google-colab",
    };
  } catch {
    return { rawText: String(text || "").trim(), model: "google-colab", provider: "google-colab" };
  }
}

import type { ModelConfig } from "./contracts";

export const defaultConfig: ModelConfig = {
  baseURL: "https://api.openai.com/v1",
  apiKey: "",
  model: "",
};

export function readConfig(): ModelConfig {
  try {
    const saved = JSON.parse(localStorage.getItem("draftline-model") || "{}");
    return Object.fromEntries(
      Object.entries(defaultConfig).map(([key, value]) => [
        key,
        typeof saved[key] === "string" ? saved[key] : value,
      ]),
    ) as ModelConfig;
  } catch {
    return { ...defaultConfig };
  }
}

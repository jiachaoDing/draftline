import { reasoningEffortSchema, type ModelConfig } from "./contracts";

export const defaultConfig: ModelConfig = {
  baseURL: "https://api.openai.com/v1",
  apiKey: "",
  model: "",
  reasoningEffort: "auto",
};

export function readConfig(): ModelConfig {
  try {
    const saved = JSON.parse(localStorage.getItem("draftline-model") || "{}");
    return {
      baseURL:
        typeof saved.baseURL === "string"
          ? saved.baseURL
          : defaultConfig.baseURL,
      apiKey:
        typeof saved.apiKey === "string" ? saved.apiKey : defaultConfig.apiKey,
      model:
        typeof saved.model === "string" ? saved.model : defaultConfig.model,
      reasoningEffort: reasoningEffortSchema
        .catch("auto")
        .parse(saved.reasoningEffort ?? "auto"),
    };
  } catch {
    return { ...defaultConfig };
  }
}

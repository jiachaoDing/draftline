import { reasoningEffortSchema, type ModelConfig } from "./contracts";
import { consumeModelSettingsLink } from "./model-settings-share";

export type InitialModelSettings = {
  config: ModelConfig;
  notice?: { text: string; error?: boolean };
};

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

export function importModelSettingsLink(): {
  config?: ModelConfig;
  notice: NonNullable<InitialModelSettings["notice"]>;
} | null {
  let shared: ModelConfig | null;
  try {
    shared = consumeModelSettingsLink();
  } catch {
    return {
      notice: {
        text: "This model settings link is invalid or incomplete. Ask the sender for a new link.",
        error: true,
      },
    };
  }
  if (!shared) return null;
  try {
    localStorage.setItem("draftline-model", JSON.stringify(shared));
  } catch {
    return {
      config: shared,
      notice: {
        text: "Shared model settings are ready for this session, but browser storage could not save them.",
        error: true,
      },
    };
  }
  return {
    config: shared,
    notice: { text: "Shared model settings loaded. You can start drawing." },
  };
}

export function initializeModelSettings(): InitialModelSettings {
  const shared = importModelSettingsLink();
  return {
    config: shared?.config ?? readConfig(),
    notice: shared?.notice,
  };
}

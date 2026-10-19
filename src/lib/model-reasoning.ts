import type { ModelConfig } from "./contracts";

export function resolveReasoningEffort(
  config: Pick<ModelConfig, "model" | "reasoningEffort">,
) {
  const effort = config.reasoningEffort ?? "auto";
  if (effort === "provider") return undefined;
  if (effort !== "auto") return effort;
  const model = config.model.trim().split("/").at(-1) ?? "";
  return /^(?:gpt-[56](?:[.-]|$)|o[134](?:-|$))/i.test(model)
    ? "high"
    : undefined;
}

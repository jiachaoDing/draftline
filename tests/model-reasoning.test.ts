import { beforeEach, expect, it } from "vitest";
import { configSchema } from "../src/lib/contracts";
import { resolveReasoningEffort } from "../src/lib/model-reasoning";
import { readConfig } from "../src/lib/model-settings";

beforeEach(() => localStorage.clear());

it.each([
  "gpt-6.1-sol",
  "gpt-6-astra",
  "gpt-5.4",
  "o3",
  "o4-mini",
  "vendor/gpt-6.1-sol",
])("defaults %s to high while preserving explicit choices", (model) => {
  expect(resolveReasoningEffort({ model })).toBe("high");
  expect(resolveReasoningEffort({ model, reasoningEffort: "low" })).toBe("low");
  expect(
    resolveReasoningEffort({ model, reasoningEffort: "provider" }),
  ).toBeUndefined();
});

it.each(["gpt-4o", "vision-test", "custom-model", "gpt-60", "o10"])(
  "leaves unknown or non-reasoning model %s at provider default",
  (model) => {
    expect(resolveReasoningEffort({ model })).toBeUndefined();
    expect(resolveReasoningEffort({ model, reasoningEffort: "high" })).toBe(
      "high",
    );
  },
);

it("restores legacy and invalid effort settings without losing credentials", () => {
  const saved = {
    baseURL: "https://gateway.example/v1",
    apiKey: "test-secret",
    model: "gpt-6.1-sol",
  };
  for (const extra of [{}, { reasoningEffort: "unsupported" }]) {
    localStorage.setItem(
      "draftline-model",
      JSON.stringify({ ...saved, ...extra }),
    );
    expect(readConfig()).toEqual({ ...saved, reasoningEffort: "auto" });
    expect(resolveReasoningEffort(readConfig())).toBe("high");
  }
  expect(
    configSchema.safeParse({ ...saved, reasoningEffort: "unsupported" })
      .success,
  ).toBe(false);
});

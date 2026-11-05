import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  consumeModelSettingsLink,
  createModelSettingsLink,
  parseModelSettingsFragment,
} from "../src/lib/model-settings-share";
import { initializeModelSettings, readConfig } from "../src/lib/model-settings";

const config = {
  baseURL: "https://gateway.example/proxy/v1",
  apiKey: "test-key-+/=&?#",
  model: "vendor/视觉-model",
  reasoningEffort: "low" as const,
};
const invalidLink =
  "This model settings link is invalid or incomplete. Ask the sender for a new link.";
function fragment(value: unknown) {
  return "#model-settings=" + btoa(JSON.stringify(value));
}

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, "", "/");
});
afterEach(() => vi.restoreAllMocks());

it("round-trips Unicode and reserved characters without query parameters or unrelated data", () => {
  const link = new URL(
    createModelSettingsLink(
      {
        ...config,
        project: "private drawing",
        extra: "ignored",
      } as typeof config,
      "https://drawing.example/workspace?private=secret#other",
    ),
  );
  expect(link.origin + link.pathname).toBe("https://drawing.example/workspace");
  expect(link.search).toBe("");
  expect(parseModelSettingsFragment(link.hash)).toEqual(config);
  const decoded = JSON.stringify(parseModelSettingsFragment(link.hash));
  expect(decoded).not.toContain("private drawing");
  expect(decoded).not.toContain("ignored");
});

it("keeps independent configurations in their original links", () => {
  const first = createModelSettingsLink(config, window.location.href);
  const secondConfig = {
    ...config,
    apiKey: "another-key",
    baseURL: "https://other.example/v1",
    model: "another-model",
  };
  const second = createModelSettingsLink(secondConfig, window.location.href);
  expect(second).not.toBe(first);
  expect(parseModelSettingsFragment(new URL(first).hash)).toEqual(config);
  expect(parseModelSettingsFragment(new URL(second).hash)).toEqual(
    secondConfig,
  );
});

it("normalizes drafts and supplies the saved reasoning default", () => {
  const link = createModelSettingsLink(
    {
      ...config,
      apiKey: " key ",
      baseURL: " https://gateway.example/v1/// ",
      model: " model ",
      reasoningEffort: undefined,
    },
    window.location.href,
  );
  expect(parseModelSettingsFragment(new URL(link).hash)).toEqual({
    baseURL: "https://gateway.example/v1",
    apiKey: "key",
    model: "model",
    reasoningEffort: "auto",
  });
});

it.each([
  { model: " " },
  { apiKey: " " },
  { apiKey: "x".repeat(4097) },
  { baseURL: "javascript:alert(1)" },
  { baseURL: "not a URL" },
  { baseURL: "http://public.example/v1" },
  { baseURL: "https://user:password@gateway.example/v1" },
  { baseURL: "https://gateway.example/v1?apiKey=secret" },
  { baseURL: "https://gateway.example/v1#key" },
])("rejects incomplete or unsafe configuration %j", (extra) => {
  expect(() =>
    createModelSettingsLink({ ...config, ...extra }, window.location.href),
  ).toThrow("Enter a valid API URL, API key and model before sharing.");
});

it.each([
  "#model-settings=",
  "#model-settings=secret-%",
  "#model-settings=" + "a".repeat(48_001),
  fragment({ version: 2, config: { ...config, model: "ascii" } }),
  fragment({
    version: 1,
    config: { ...config, model: "", apiKey: "secret-key" },
  }),
  fragment({
    version: 1,
    config: { ...config, model: "ascii", reasoningEffort: "invalid" },
  }),
])("rejects malformed links with credential-free errors", (hash) => {
  expect(() => parseModelSettingsFragment(hash)).toThrow(invalidLink);
});

it("consumes the fragment once, replaces history and persists only model settings", () => {
  const link = createModelSettingsLink(config, window.location.href);
  window.history.replaceState({ workspace: "kept" }, "", link);
  const initial = initializeModelSettings();
  expect(initial.config).toEqual(config);
  expect(initial.notice?.error).toBeUndefined();
  expect(window.location.hash).toBe("");
  expect(window.history.state).toEqual({ workspace: "kept" });
  expect(readConfig()).toEqual(config);
  expect(consumeModelSettingsLink()).toBeNull();
});

it("clears invalid fragments and preserves existing credentials", () => {
  localStorage.setItem("draftline-model", JSON.stringify(config));
  window.history.replaceState(null, "", "/?view=kept#model-settings=broken");
  const initial = initializeModelSettings();
  expect(initial.config).toEqual(config);
  expect(initial.notice).toEqual({ text: invalidLink, error: true });
  expect(window.location.href).toMatch(/\/\?view=kept$/);
  expect(readConfig()).toEqual(config);
});

it("uses shared credentials for the session when storage cannot save", () => {
  window.history.replaceState(
    null,
    "",
    createModelSettingsLink(config, window.location.href),
  );
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("Storage unavailable");
  });
  const initial = initializeModelSettings();
  expect(initial.config).toEqual(config);
  expect(initial.notice?.text).toContain("ready for this session");
  expect(initial.notice?.error).toBe(true);
  expect(window.location.hash).toBe("");
});

it("leaves unrelated fragments and existing settings intact", () => {
  localStorage.setItem("draftline-model", JSON.stringify(config));
  window.history.replaceState(null, "", "/#workspace-help");
  expect(initializeModelSettings()).toEqual({ config, notice: undefined });
  expect(window.location.hash).toBe("#workspace-help");
});

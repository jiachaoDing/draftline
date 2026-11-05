import { z } from "zod";
import {
  configSchema,
  reasoningEffortSchema,
  type ModelConfig,
} from "./contracts";

const fragmentPrefix = "#model-settings=";
const maxPayloadLength = 48_000;
const sharedConfigSchema = configSchema.extend({
  baseURL: configSchema.shape.baseURL
    .trim()
    .url()
    .refine((value) => {
      try {
        const url = new URL(value);
        const local = ["localhost", "127.0.0.1", "[::1]"].includes(
          url.hostname,
        );
        return (
          (url.protocol === "https:" || (local && url.protocol === "http:")) &&
          !url.username &&
          !url.password &&
          !url.search &&
          !url.hash
        );
      } catch {
        return false;
      }
    })
    .transform((value) => value.replace(/\/+$/, "")),
  apiKey: configSchema.shape.apiKey.trim().min(1),
  model: configSchema.shape.model.removeDefault().trim().min(1),
  reasoningEffort: reasoningEffortSchema.default("auto"),
});
const sharedSettingsSchema = z.object({
  version: z.literal(1),
  config: sharedConfigSchema,
});

export function createModelSettingsLink(config: ModelConfig, pageURL: string) {
  const result = sharedConfigSchema.safeParse(config);
  if (!result.success)
    throw new Error("Enter a valid API URL, API key and model before sharing.");
  const bytes = new TextEncoder().encode(
    JSON.stringify({ version: 1, config: result.data }),
  );
  const payload = btoa(
    Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""),
  )
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const url = new URL(pageURL);
  url.search = "";
  url.hash = fragmentPrefix + payload;
  return url.toString();
}

export function parseModelSettingsFragment(
  fragment: string,
): ModelConfig | null {
  if (!fragment.startsWith(fragmentPrefix)) return null;
  try {
    const payload = fragment.slice(fragmentPrefix.length);
    if (
      !payload ||
      payload.length > maxPayloadLength ||
      !/^[\w-]+$/.test(payload)
    )
      throw new Error();
    const bytes = Uint8Array.from(
      atob(payload.replace(/-/g, "+").replace(/_/g, "/")),
      (char) => char.charCodeAt(0),
    );
    return sharedSettingsSchema.parse(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
    ).config;
  } catch {
    // Never reflect credential-bearing fragments or parser diagnostics.
    throw new Error(
      "This model settings link is invalid or incomplete. Ask the sender for a new link.",
    );
  }
}

export function consumeModelSettingsLink(): ModelConfig | null {
  const fragment = window.location.hash;
  if (!fragment.startsWith(fragmentPrefix)) return null;
  // Replace the current history entry before validation or any app/frame startup.
  window.history.replaceState(
    window.history.state,
    "",
    window.location.pathname + window.location.search,
  );
  return parseModelSettingsFragment(fragment);
}

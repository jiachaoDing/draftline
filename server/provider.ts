import OpenAI from "openai";
import { resultSchema, type ModelConfig } from "../src/lib/contracts";

export function normalizeBaseURL(value: string, allowLocal = false) {
  const url = new URL(value.trim());
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const local = host === "localhost" || host === "127.0.0.1" || host === "::1";
  const blocked =
    /^(0|10|127)\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host) ||
    host === "0.0.0.0" ||
    host.includes(":") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    !host.includes(".");
  if (
    (url.protocol !== "https:" &&
      !(allowLocal && local && url.protocol === "http:")) ||
    (blocked && !(allowLocal && local)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "Use a public HTTPS API URL. Localhost HTTP is supported by the local development server.",
    );
  }
  url.pathname = url.pathname.replace(/\/+$/, "") || "/v1";
  return url.toString().replace(/\/$/, "");
}

export function createProvider(config: ModelConfig, allowLocal = false) {
  return new OpenAI({
    apiKey: config.apiKey,
    baseURL: normalizeBaseURL(config.baseURL, allowLocal),
    timeout: 120_000,
    maxRetries: 0,
    logLevel: "off",
  });
}

export function parseAIResult(content: string) {
  const cleaned = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  let result: unknown;
  try {
    result = JSON.parse(cleaned);
  } catch {
    throw new Error(
      "The model returned invalid JSON. Try again or choose a model that supports structured instructions.",
    );
  }
  const parsed = resultSchema.safeParse(result);
  if (!parsed.success)
    throw new Error(
      "The model returned an incomplete drawing response. Try again with a more capable model.",
    );
  return parsed.data;
}

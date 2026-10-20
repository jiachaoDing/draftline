import OpenAI from "openai";
import { resultSchema, type ModelConfig } from "../src/lib/contracts";
import { ModelFailure } from "../src/lib/model-failure";

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
  } catch (error) {
    const message = (error as Error).message;
    const position = /position (\d+)/i.exec(message)?.[1];
    throw new ModelFailure("The model returned invalid JSON.", {
      code: "invalid_json",
      retryable: true,
      diagnostic: {
        category: !/^[{[]/.test(cleaned)
          ? "plain_text"
          : /escape|unicode/i.test(message)
            ? "invalid_escape"
            : /end of|unterminated/i.test(message)
              ? "truncated_json"
              : "malformed_json",
        length: Math.min(content.length, 1_200_000),
        finish: "stop",
        ...(position ? { position: Number(position) } : {}),
      },
    });
  }
  const parsed = resultSchema.safeParse(result);
  if (!parsed.success)
    throw new ModelFailure(
      "The model returned an incomplete drawing response.",
      {
        code: "invalid_response",
        retryable: true,
        diagnostic: {
          category: "invalid_shape",
          length: Math.min(content.length, 1_200_000),
          finish: "stop",
        },
      },
    );
  return parsed.data;
}

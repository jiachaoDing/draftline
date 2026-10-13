// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { createApp } from "../server/app";
import { normalizeBaseURL, parseAIResult } from "../server/provider";

let server: Server;
let baseURL: string;
let responseContent =
  '{"kind":"clarification","question":"What is the plate width in mm?"}';
const app = createApp(true);
beforeAll(async () => {
  server = createServer(async (req, res) => {
    if (req.headers.authorization !== "Bearer test-only-key") {
      res.writeHead(401);
      res.end("{}");
      return;
    }
    let body = "";
    for await (const chunk of req) body += chunk;
    res.setHeader("content-type", "application/json");
    if (req.url === "/v1/models")
      res.end(
        JSON.stringify({
          data: [{ id: "vision-test" }, { id: "text-test" }],
          object: "list",
        }),
      );
    else
      res.end(
        JSON.stringify({
          id: "test",
          object: "chat.completion",
          created: 0,
          model: "vision-test",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: responseContent },
              finish_reason: "stop",
            },
          ],
        }),
      );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseURL = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
const call = (path: string, body: unknown, origin?: string) =>
  app.request(`http://app.test${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(origin ? { Origin: origin } : {}),
    },
    body: JSON.stringify(body),
  });
const config = () => ({
  baseURL,
  apiKey: "test-only-key",
  model: "vision-test",
});

describe("OpenAI-compatible server integration", () => {
  it("discovers models through the official SDK", async () => {
    const response = await call("/api/models", config());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      models: ["text-test", "vision-test"],
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("tests the selected model and returns structured clarification", async () => {
    expect((await call("/api/test", config())).status).toBe(200);
    const response = await call("/api/draw", {
      config: config(),
      mode: "generate",
      instruction: "Draw a plate",
      history: [],
    });
    expect(await response.json()).toEqual({
      kind: "clarification",
      question: "What is the plate width in mm?",
    });
  });
  it("handles authentication failure without returning credentials", async () => {
    const response = await call("/api/models", {
      ...config(),
      apiKey: "invalid-secret",
    });
    expect(response.status).toBe(502);
    const text = await response.text();
    expect(text).toContain("API key was rejected");
    expect(text).not.toContain("invalid-secret");
  });
  it("rejects cross-origin and malformed requests", async () => {
    expect(
      (await call("/api/models", config(), "https://evil.example")).status,
    ).toBe(403);
    expect(
      (
        await call("/api/draw", {
          config: config(),
          mode: "edit",
          instruction: "Change it",
        })
      ).status,
    ).toBe(400);
  });
  it("rejects invalid model responses", async () => {
    responseContent = "some invalid code";
    const response = await call("/api/draw", {
      config: config(),
      mode: "generate",
      instruction: "Draw a plate",
    });
    expect(response.status).toBe(502);
    expect(await response.text()).toContain("invalid JSON");
  });
});

describe("provider URL and output handling", () => {
  it("normalizes public API roots and blocks private addresses in hosted mode", () => {
    expect(normalizeBaseURL("https://api.example.com/")).toBe(
      "https://api.example.com/v1",
    );
    expect(normalizeBaseURL("https://api.example.com/custom/v1/")).toBe(
      "https://api.example.com/custom/v1",
    );
    for (const url of [
      "http://api.example.com",
      "https://127.0.0.1",
      "https://10.0.0.1",
      "https://192.168.0.1",
      "https://[::1]",
      "https://metadata.internal",
      "https://user:pass@example.com",
      "https://example.com/v1?key=x",
    ])
      expect(() => normalizeBaseURL(url)).toThrow();
    expect(normalizeBaseURL("http://localhost:3009/v1", true)).toBe(
      "http://localhost:3009/v1",
    );
  });
  it("accepts fenced JSON and rejects incomplete drawings", () => {
    expect(
      parseAIResult(
        '```json\n{"kind":"clarification","question":"Width?"}\n```',
      ).kind,
    ).toBe("clarification");
    expect(() => parseAIResult('{"kind":"drawing"}')).toThrow("incomplete");
  });
});

// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { createApp } from "../server/app";
import { normalizeBaseURL, parseAIResult } from "../server/provider";
import { readAIStream } from "../src/lib/stream";
import {
  completeResponse,
  contentChunk,
  finishCompletion,
  openCompletion,
} from "./helpers/provider-stream";
import type { AIResult } from "../src/lib/contracts";

let server: Server;
let baseURL: string;
let responseContent =
  '{"kind":"clarification","question":"What is the plate width in mm?"}';
const app = createApp(true);
let releaseDelayed: () => void;
let cancelled: Promise<void>;
let upstreamRequests: Array<{ stream?: boolean }> = [];
beforeEach(() => {
  responseContent =
    '{"kind":"clarification","question":"What is the plate width in mm?"}';
  upstreamRequests = [];
});
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
    else {
      const input = JSON.parse(body);
      upstreamRequests.push(input);
      const instruction = JSON.stringify(input.messages);
      if (instruction.includes("delayed reply")) {
        openCompletion(res);
        contentChunk(res, '{"kind":"message","message":"Hello');
        await new Promise<void>((resolve) => {
          releaseDelayed = resolve;
        });
        contentChunk(res, ' streaming world"}');
        finishCompletion(res);
      } else if (instruction.includes("abort reply")) {
        cancelled = new Promise((resolve) => res.once("close", resolve));
        openCompletion(res);
        contentChunk(res, '{"kind":"message","message":"Still working');
      } else if (instruction.includes("disconnect reply")) {
        openCompletion(res);
        contentChunk(res, '{"kind":"message","message":"Looks complete"}');
        res.end();
      } else if (instruction.includes("provider error")) {
        openCompletion(res);
        contentChunk(res, '{"kind":"message","message":"Working');
        res.end(
          `data: ${JSON.stringify({ error: { message: "private test-only-key provider detail" } })}\n\n`,
        );
      } else if (instruction.includes("token limit")) {
        openCompletion(res);
        contentChunk(res, '{"kind":"message","message":"Complete JSON"}');
        finishCompletion(res, "length");
      } else completeResponse(res, responseContent);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseURL = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
const call = (
  path: string,
  body: unknown,
  origin?: string,
  signal?: AbortSignal,
) =>
  app.request(`http://app.test${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(origin ? { Origin: origin } : {}),
    },
    body: JSON.stringify(body),
    signal,
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
    expect(await readAIStream(await call("/api/test", config()))).toEqual({
      ok: true,
      model: "vision-test",
    });
    const response = await call("/api/draw", {
      config: config(),
      mode: "generate",
      instruction: "Draw a plate",
      history: [],
    });
    expect(await readAIStream(response)).toEqual({
      kind: "clarification",
      question: "What is the plate width in mm?",
    });
    expect(upstreamRequests.every((request) => request.stream === true)).toBe(
      true,
    );
    expect(response.headers.get("cache-control")).toBe(
      "no-store, no-transform",
    );
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
    expect(response.status).toBe(200);
    await expect(readAIStream(response)).rejects.toThrow("invalid JSON");
  });
  it("delivers model tokens before the upstream response finishes", async () => {
    const response = await call("/api/draw", {
      config: config(),
      mode: "generate",
      instruction: "delayed reply",
    });
    let received = "";
    let signalFirst: () => void;
    const first = new Promise<void>((resolve) => {
      signalFirst = resolve;
    });
    let completed = false;
    const result = readAIStream<AIResult>(response, (text) => {
      received += text;
      signalFirst();
    }).then((result) => {
      completed = true;
      return result;
    });
    await first;
    expect(received).toContain("Hello");
    expect(completed).toBe(false);
    releaseDelayed();
    expect(await result).toEqual({
      kind: "message",
      message: "Hello streaming world",
    });
  });
  it("cancels the actual upstream connection", async () => {
    const controller = new AbortController();
    const response = await call(
      "/api/draw",
      { config: config(), mode: "generate", instruction: "abort reply" },
      undefined,
      controller.signal,
    );
    let firstToken: () => void;
    const first = new Promise<void>((resolve) => {
      firstToken = resolve;
    });
    const result = readAIStream(response, () => firstToken()).catch(
      (error) => error,
    );
    await first;
    controller.abort();
    await cancelled;
    expect(await result).toBeInstanceOf(Error);
  });
  it("rejects premature EOF and token limits even when the JSON is complete", async () => {
    for (const instruction of ["disconnect reply", "token limit"]) {
      const response = await call("/api/draw", {
        config: config(),
        mode: "generate",
        instruction,
      });
      await expect(readAIStream(response)).rejects.toThrow(
        instruction === "token limit" ? "token limit" : "before completion",
      );
    }
  });
  it("sanitizes errors received inside an already-started provider stream", async () => {
    const response = await call("/api/draw", {
      config: config(),
      mode: "generate",
      instruction: "provider error",
    });
    const error = await readAIStream<never>(response).catch(
      (error) => error as Error,
    );
    expect(error.message).toContain("interrupted");
    expect(error.message).not.toContain("test-only-key");
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

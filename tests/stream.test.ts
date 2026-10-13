// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { readAIStream, streamPost } from "../src/lib/stream";
import { previewStream } from "../src/lib/stream-preview";

const encode = (text: string) => new TextEncoder().encode(text);
const event = (type: string, data: unknown) =>
  `event: ${type}\r\ndata: ${JSON.stringify(data)}\r\n\r\n`;
const response = (body: ReadableStream<Uint8Array>) =>
  new Response(body, { headers: { "Content-Type": "text/event-stream" } });
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("shared frontend stream transport", () => {
  it("handles SSE framing and Chinese/emoji split across single-byte packets", async () => {
    const content = `: heartbeat\r\n\r\n${event("delta", { text: "你好 🔧\n" })}${event("result", { kind: "message", message: "你好 🔧" })}`;
    const bytes = encode(content);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
        controller.close();
      },
    });
    let text = "";
    expect(
      await readAIStream(response(body), (chunk) => {
        text += chunk;
      }),
    ).toEqual({ kind: "message", message: "你好 🔧" });
    expect(text).toBe("你好 🔧\n");
  });
  it("rejects EOF without a terminal result and preserves server error messages", async () => {
    const ended = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encode(event("delta", { text: "Partial" })));
        controller.close();
      },
    });
    await expect(readAIStream(response(ended))).rejects.toThrow(
      "interrupted before completion",
    );
    const failed = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encode(event("error", { error: "Provider rate limit reached." })),
        );
        controller.close();
      },
    });
    await expect(readAIStream(response(failed))).rejects.toThrow(
      "Provider rate limit",
    );
  });
  it("propagates user cancellation to the fetch signal and reports AbortError", async () => {
    const controller = new AbortController();
    let requestSignal!: AbortSignal;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, options: RequestInit) => {
        requestSignal = options.signal!;
        const body = new ReadableStream<Uint8Array>({
          start(output) {
            output.enqueue(encode(event("delta", { text: "First" })));
            requestSignal.addEventListener("abort", () =>
              output.error(new DOMException("Aborted", "AbortError")),
            );
          },
        });
        return response(body);
      }),
    );
    const result = streamPost("/api/draw", {}, controller.signal, () =>
      controller.abort(),
    );
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(requestSignal.aborted).toBe(true);
  });
  it("times out a silent connection without automatically replaying a model request", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(
      (_url, options: RequestInit) =>
        new Promise<Response>((_resolve, reject) =>
          options.signal!.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          ),
        ),
    );
    vi.stubGlobal("fetch", fetch);
    const result = streamPost("/api/test", {});
    const check = expect(result).rejects.toThrow("stopped sending data");
    await vi.advanceTimersByTimeAsync(45_001);
    await check;
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("display-only partial response decoding", () => {
  it("shows normal answers and clarification before the closing JSON", () => {
    expect(
      previewStream('{"kind":"message","message":"Hello stream').text,
    ).toBe("Hello stream");
    expect(
      previewStream('{"kind":"clarification","question":"需要多少毫米').text,
    ).toBe("需要多少毫米");
  });
  it("decodes escaped drawing code and partial patches as plain text", () => {
    const source =
      '{"kind":"drawing","summary":"Creating the plate","html":"<svg id=\\"drawing\\">\\n<script>unsafe()';
    expect(previewStream(source)).toEqual({
      text: "Creating the plate",
      code: '<svg id="drawing">\n<script>unsafe()',
    });
    expect(
      previewStream(
        '{"kind":"patch","summary":"Updating radius","patches":[{"id":"hole","svg":"<circle r=\\"7',
      ).code,
    ).toContain('<circle r="7');
    expect(previewStream("invalid provider data")).toEqual({
      text: "",
      code: "",
    });
  });
});

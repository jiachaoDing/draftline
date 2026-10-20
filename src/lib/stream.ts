import { EventSourceParserStream } from "eventsource-parser/stream";
import { toolPendingSchema, type ToolPending } from "./agent-activity";
import { ModelFailure, modelFailureSchema } from "./model-failure";

const INTERRUPTED =
  "The streaming connection was interrupted before completion. Please try again.";
export class AIStreamError extends ModelFailure {}
const connectionFailure = { code: "connection", retryable: true } as const;
export type DeltaHandler = (text: string) => void;

/** Decode actual SSE frames and UTF-8 packet boundaries. A terminal result is mandatory. */
export async function readAIStream<T>(
  response: Response,
  onDelta?: DeltaHandler,
  onActivity?: () => void,
  onToolPending?: (event: ToolPending) => void,
): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new AIStreamError(
      body?.error || "The server could not start the AI request.",
      response.status >= 500 ? connectionFailure : undefined,
    );
  }
  if (
    !response.body ||
    !response.headers.get("content-type")?.includes("text/event-stream")
  )
    throw new AIStreamError(
      "The server did not return a streaming response. Check your connection.",
      connectionFailure,
    );
  const reader = response.body
    .pipeThrough(
      new TransformStream<Uint8Array<ArrayBuffer>, BufferSource>({
        transform(chunk, controller) {
          onActivity?.();
          controller.enqueue(chunk);
        },
      }),
    )
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(
      new EventSourceParserStream({
        onError: "terminate",
        maxBufferSize: 1_500_000,
      }),
    )
    .getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) throw new AIStreamError(INTERRUPTED, connectionFailure);
      if (
        !["delta", "result", "error", "tool_pending"].includes(
          value.event || "",
        )
      )
        continue;
      let data;
      try {
        data = JSON.parse(value.data);
      } catch {
        throw new AIStreamError(
          "The server sent an invalid stream event. Please try again.",
          connectionFailure,
        );
      }
      if (value.event === "error")
        throw new AIStreamError(
          typeof data.error === "string" ? data.error : INTERRUPTED,
          modelFailureSchema.safeParse(data).data,
        );
      if (value.event === "tool_pending") {
        const parsed = toolPendingSchema.safeParse(data);
        if (!parsed.success)
          throw new AIStreamError(
            "The server sent an invalid activity event. Please try again.",
          );
        onToolPending?.(parsed.data);
      }
      if (value.event === "delta") {
        if (typeof data.text !== "string")
          throw new AIStreamError(
            "The server sent an invalid text chunk. Please try again.",
          );
        onDelta?.(data.text);
      }
      if (value.event === "result") {
        if (!data || typeof data !== "object")
          throw new AIStreamError(
            "The server returned an invalid completed response.",
          );
        return data as T;
      }
    }
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function streamPost<T>(
  path: string,
  body: unknown,
  signal?: AbortSignal,
  onDelta?: DeltaHandler,
  onToolPending?: (event: ToolPending) => void,
): Promise<T> {
  const transport = new AbortController();
  const combined = signal
    ? AbortSignal.any([signal, transport.signal])
    : transport.signal;
  let timer: ReturnType<typeof setTimeout>;
  let timedOut = false;
  const armTimeout = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timedOut = true;
      transport.abort();
    }, 45_000);
  };
  armTimeout();
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify(body),
      signal: combined,
    });
    armTimeout();
    return await readAIStream<T>(response, onDelta, armTimeout, onToolPending);
  } catch (error) {
    if (signal?.aborted)
      throw new DOMException("Generation cancelled.", "AbortError");
    if (timedOut)
      throw new AIStreamError(
        "The streaming connection stopped sending data. Please try again.",
        connectionFailure,
      );
    if (error instanceof AIStreamError) throw error;
    throw new AIStreamError(INTERRUPTED, connectionFailure);
  } finally {
    clearTimeout(timer!);
    transport.abort();
  }
}

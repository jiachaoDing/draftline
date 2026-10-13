import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import OpenAI from "openai";

export class AIStreamError extends Error {}
export function providerErrorMessage(error: Error, streaming = false) {
  if (error instanceof AIStreamError) return error.message;
  if (error instanceof OpenAI.APIError) {
    const messages: Record<number, string> = {
      400: "The provider rejected the request. Check model compatibility and image support.",
      401: "The API key was rejected. Check your credentials.",
      403: "Your API key does not have access to this model.",
      404: "API endpoint or model not found. Check your Base URL and model.",
      429: "Provider rate limit or quota reached. Please try again later.",
    };
    return (
      messages[error.status || 0] ||
      (streaming
        ? "The AI provider interrupted its stream. Please try again."
        : "The AI provider is unavailable. Check your connection and try again.")
    );
  }
  const safe = [
    "Use a public HTTPS API URL.",
    "The model returned invalid JSON.",
    "The model returned an incomplete drawing response.",
  ];
  if (safe.some((prefix) => error.message.startsWith(prefix)))
    return error.message;
  return streaming
    ? "The model connection was interrupted before completion. Please try again."
    : "Unable to connect to the AI provider. Check your Base URL and network.";
}

/** One transport for conversations, clarification, drawings, patches, and model tests. */
export function streamAI<T>(
  c: Context,
  client: OpenAI,
  params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
  finalize: (content: string) => T,
) {
  const response = streamSSE(c, async (output) => {
    const controller = new AbortController();
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let timedOut = false;
    const cancel = () => {
      clearTimeout(watchdog);
      clearInterval(heartbeat);
      controller.abort();
    };
    const armWatchdog = () => {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, 120_000);
    };
    output.onAbort(cancel);
    c.req.raw.signal.addEventListener("abort", cancel, { once: true });
    if (c.req.raw.signal.aborted || output.aborted) cancel();
    try {
      controller.signal.throwIfAborted();
      await output.writeSSE({ event: "start", data: "{}" });
      armWatchdog();
      heartbeat = setInterval(() => {
        if (!output.aborted) void output.write(": keep-alive\n\n");
      }, 15_000);
      const upstream = await client.chat.completions.create(
        { ...params, stream: true },
        { signal: controller.signal },
      );
      let content = "";
      let finishReason: string | null = null;
      for await (const chunk of upstream) {
        if (controller.signal.aborted || output.aborted) break;
        armWatchdog();
        const choice = chunk.choices?.find((choice) => choice.index === 0);
        if (choice?.delta?.refusal)
          throw new AIStreamError(
            "The model declined this request. Adjust your instructions.",
          );
        const text = choice?.delta?.content;
        if (text) {
          content += text;
          if (content.length > 1_200_000)
            throw new AIStreamError(
              "The model response is too large. Simplify the drawing and try again.",
            );
          await output.writeSSE({
            event: "delta",
            data: JSON.stringify({ text }),
          });
        }
        if (choice?.finish_reason) {
          finishReason = choice.finish_reason;
          break;
        }
      }
      if (timedOut)
        throw new AIStreamError(
          "The model stopped sending data. Please try again.",
        );
      if (controller.signal.aborted || output.aborted) return;
      if (finishReason === "content_filter")
        throw new AIStreamError(
          "The model declined this request. Adjust your instructions.",
        );
      if (finishReason !== "stop")
        throw new AIStreamError(
          finishReason === "length"
            ? "The model response was cut off by its token limit. Please try again with a smaller drawing."
            : "The provider ended the stream before completion. Check streaming support and try again.",
        );
      if (!content.trim())
        throw new AIStreamError(
          "The model returned no content. Check model compatibility.",
        );
      const result = finalize(content);
      if (!controller.signal.aborted && !output.aborted)
        await output.writeSSE({
          event: "result",
          data: JSON.stringify(result),
        });
    } catch (error) {
      if (!output.aborted && !c.req.raw.signal.aborted) {
        const message = timedOut
          ? "The model stopped sending data. Please try again."
          : providerErrorMessage(error as Error, true);
        await output.writeSSE({
          event: "error",
          data: JSON.stringify({ error: message }),
        });
      }
    } finally {
      cancel();
      c.req.raw.signal.removeEventListener("abort", cancel);
    }
  });
  // Preserve credential-response privacy and disable intermediary buffering.
  response.headers.set("Cache-Control", "no-store, no-transform");
  response.headers.set("X-Accel-Buffering", "no");
  return response;
}

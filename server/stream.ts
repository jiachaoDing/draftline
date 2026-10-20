import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import OpenAI from "openai";
import { APICallError } from "ai";
import { modelStream } from "./model-stream";
import { toolStreamPolicy } from "./tool-stream-policy";
import { userInputResultSchema } from "../src/lib/contracts";
import { agentCallsResultSchema } from "../src/lib/agent-contracts";
import { toolPendingSchema } from "../src/lib/agent-activity";
import { ModelFailure } from "../src/lib/model-failure";

export class AIStreamError extends ModelFailure {}
export function providerErrorMessage(error: Error, streaming = false) {
  if (error instanceof ModelFailure) return error.message;
  if (error instanceof OpenAI.APIError || APICallError.isInstance(error)) {
    const messages: Record<number, string> = {
      400: "The provider rejected the request. Check model compatibility and image support.",
      401: "The API key was rejected. Check your credentials.",
      403: "Your API key does not have access to this model.",
      404: "API endpoint or model not found. Check your Base URL and model.",
      429: "Provider rate limit or quota reached. Please try again later.",
    };
    return (
      messages[
        (error instanceof OpenAI.APIError ? error.status : error.statusCode) ||
          0
      ] ||
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
  allowUserInput = false,
  allowAgentTools = false,
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
      const upstream = modelStream(client, params, controller.signal);
      let content = "";
      let finishReason: string | null = null;
      const calls = new Map<
        number,
        { id: string; name: string; arguments: string }
      >();
      const pendingIds = new Map<string, number>();
      const checkToolPolicy = toolStreamPolicy(
        allowUserInput,
        allowAgentTools ? 200_000 : 32000,
      );
      for await (const chunk of upstream) {
        if (controller.signal.aborted || output.aborted) break;
        armWatchdog();
        if (chunk.type === "raw") checkToolPolicy(chunk.rawValue);
        if (chunk.type === "error") throw chunk.error;
        const text = chunk.type === "text-delta" ? chunk.text : undefined;
        if (chunk.type === "tool-input-start") {
          const index = pendingIds.size;
          if (!allowUserInput || index > 3)
            throw new AIStreamError(
              "The model returned an unsupported tool call.",
            );
          pendingIds.set(chunk.id, index);
          const pending = toolPendingSchema.safeParse({
            index,
            name: chunk.toolName,
          });
          if (pending.success)
            await output.writeSSE({
              event: "tool_pending",
              data: JSON.stringify(pending.data),
            });
        }
        if (chunk.type === "tool-call") {
          const call = {
            id: chunk.toolCallId,
            name: chunk.toolName,
            arguments:
              chunk.invalid && typeof chunk.input === "string"
                ? chunk.input
                : JSON.stringify(chunk.input),
          };
          if (
            call.arguments.length > (allowAgentTools ? 200_000 : 32000) ||
            call.id.length > 200 ||
            call.name.length > 100
          )
            throw new AIStreamError(
              "The model returned an oversized tool call.",
            );
          calls.set(pendingIds.get(call.id) ?? calls.size, call);
        }
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
        if (chunk.type === "finish") {
          finishReason = chunk.finishReason.replaceAll("-", "_");
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
      if (finishReason === "tool_calls" && allowUserInput) {
        const ordered = [...calls.entries()].sort(([a], [b]) => a - b);
        if (
          ordered.some(
            ([, call]) =>
              !params.tools?.some(
                (tool) =>
                  tool.type === "function" && tool.function.name === call.name,
              ),
          )
        )
          throw new AIStreamError(
            "The model returned an unsupported tool call.",
          );
        if (ordered.some(([index], position) => index !== position))
          throw new AIStreamError(
            "The model returned invalid tool call indices. Please try again.",
          );
        if (
          allowAgentTools &&
          ordered.some(([, call]) => call.name !== "request_user_input")
        ) {
          const parsed = agentCallsResultSchema.safeParse({
            kind: "tool_calls",
            content,
            calls: ordered.map(([, call]) => call),
          });
          if (!parsed.success)
            throw new AIStreamError(
              "The model returned invalid tool calls. Please try again.",
            );
          await output.writeSSE({
            event: "result",
            data: JSON.stringify(parsed.data),
          });
          return;
        }
        if (ordered.some(([, call]) => call.name !== "request_user_input"))
          throw new AIStreamError(
            "The model returned an unsupported tool call.",
          );
        const parsed = userInputResultSchema.safeParse({
          kind: "request_user_input",
          content,
          calls: ordered.map(([, call]) => ({
            id: call.id,
            arguments: call.arguments,
          })),
        });
        if (!parsed.success)
          throw new AIStreamError(
            "The model returned invalid request_user_input questions. Please try again.",
          );
        await output.writeSSE({
          event: "result",
          data: JSON.stringify(parsed.data),
        });
        return;
      }
      if (calls.size)
        throw new AIStreamError(
          "The provider ended a tool call before completion. Please try again.",
          {
            code: finishReason === "length" ? "truncated" : "connection",
            retryable: true,
            diagnostic: {
              category:
                finishReason === "length" ? "token_limit" : "incomplete_stream",
              length: content.length,
              finish: finishReason === "length" ? "length" : "missing",
            },
          },
        );
      if (finishReason !== "stop")
        throw new AIStreamError(
          finishReason === "length"
            ? "The model response was cut off by its token limit. Please try again with a smaller drawing."
            : "The provider ended the stream before completion. Check streaming support and try again.",
          {
            code: finishReason === "length" ? "truncated" : "connection",
            retryable: true,
            diagnostic: {
              category:
                finishReason === "length" ? "token_limit" : "incomplete_stream",
              length: content.length,
              finish: finishReason === "length" ? "length" : "missing",
            },
          },
        );
      if (!content.trim())
        throw new AIStreamError(
          "The model returned no content. Check model compatibility.",
          {
            code: "invalid_response",
            retryable: true,
            diagnostic: {
              category: "invalid_completion",
              length: content.length,
              finish: "stop",
            },
          },
        );
      const result = finalize(content);
      if (!controller.signal.aborted && !output.aborted)
        await output.writeSSE({
          event: "result",
          data: JSON.stringify(result),
        });
    } catch (error) {
      if (!output.aborted && !c.req.raw.signal.aborted) {
        const status =
          error instanceof OpenAI.APIError
            ? error.status
            : APICallError.isInstance(error)
              ? error.statusCode
              : undefined;
        const message = timedOut
          ? "The model stopped sending data. Please try again."
          : providerErrorMessage(error as Error, true);
        await output.writeSSE({
          event: "error",
          data: JSON.stringify({
            error: message,
            ...(error instanceof ModelFailure && error.info
              ? error.info
              : timedOut ||
                  (!(error instanceof ModelFailure) &&
                    (!status || status >= 500))
                ? { code: "connection", retryable: true }
                : {}),
          }),
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

import { streamText, jsonSchema, type ModelMessage, type ToolSet } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type OpenAI from "openai";

function toolInput(argumentsText: string): unknown {
  try {
    return JSON.parse(argumentsText);
  } catch {
    // A failed tool's raw call stays paired with its corrective result.
    return argumentsText;
  }
}

/** Translate the app's validated provider context into AI SDK's universal messages. */
function sdkMessages(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
): ModelMessage[] {
  const toolNames = new Map<string, string>();
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const call of message.tool_calls || [])
      if (call.type === "function") toolNames.set(call.id, call.function.name);
  }
  return messages.map((message): ModelMessage => {
    if (message.role === "tool")
      return {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: message.tool_call_id,
            toolName:
              toolNames.get(message.tool_call_id) || "request_user_input",
            output: { type: "text", value: String(message.content) },
          },
        ],
      };
    if (message.role === "assistant")
      return {
        role: "assistant",
        content: [
          ...(message.content
            ? [{ type: "text" as const, text: String(message.content) }]
            : []),
          ...(message.tool_calls || []).flatMap((call) =>
            call.type === "function"
              ? [
                  {
                    type: "tool-call" as const,
                    toolCallId: call.id,
                    toolName: call.function.name,
                    input: toolInput(call.function.arguments),
                    providerOptions: {
                      openaiCompatible: { function: { ...call.function } },
                    },
                  },
                ]
              : [],
          ),
        ],
      };
    if (message.role === "system" || message.role === "developer")
      return { role: "system", content: String(message.content) };
    if (message.role !== "user") throw new Error("Unsupported message role.");
    return {
      role: "user",
      content:
        typeof message.content === "string"
          ? message.content
          : message.content.map((part) =>
              part.type === "text"
                ? { type: "text" as const, text: part.text }
                : part.type === "image_url"
                  ? {
                      type: "file" as const,
                      data: part.image_url.url,
                      mediaType:
                        /^data:([^;]+);/.exec(part.image_url.url)?.[1] ||
                        "image/png",
                      providerOptions: {
                        openaiCompatible: { image_url: { ...part.image_url } },
                      },
                    }
                  : { type: "text" as const, text: "" },
            ),
    };
  });
}

export function modelStream(
  client: OpenAI,
  params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
  abortSignal: AbortSignal,
) {
  const provider = createOpenAICompatible({
    name: "draftline",
    baseURL: client.baseURL,
    apiKey: client.apiKey || undefined,
    transformRequestBody: (body) => ({
      ...body,
      messages: (body.messages as { role: string; content: unknown }[]).map(
        (message, index) =>
          message.role === "user" &&
          typeof message.content === "string" &&
          Array.isArray(params.messages[index]?.content)
            ? { ...message, content: [{ type: "text", text: message.content }] }
            : message,
      ),
      ...(params.parallel_tool_calls !== undefined
        ? { parallel_tool_calls: params.parallel_tool_calls }
        : {}),
    }),
  });
  const tools: ToolSet = {};
  for (const tool of params.tools || []) {
    if (tool.type !== "function") continue;
    tools[tool.function.name] = {
      description: tool.function.description,
      // Browser tools validate arguments and return corrective feedback. The SDK
      // owns framing/JSON assembly; the declared schema is sent to the model.
      inputSchema: jsonSchema(tool.function.parameters || {}, {
        validate: async (value) => ({ success: true, value }),
      }),
    };
  }
  return streamText({
    model: provider.chatModel(params.model),
    instructions:
      params.messages
        .filter(
          (message) =>
            message.role === "system" || message.role === "developer",
        )
        .map((message) => String(message.content))
        .join("\n") || undefined,
    messages: sdkMessages(
      params.messages.filter(
        (message) => message.role !== "system" && message.role !== "developer",
      ),
    ),
    tools,
    toolOrder: Object.keys(tools),
    abortSignal,
    maxRetries: 0,
    includeRawChunks: true,
    providerOptions: {
      draftline: {
        ...(params.reasoning_effort
          ? { reasoningEffort: params.reasoning_effort }
          : {}),
      },
    },
    onError: () => {},
  }).fullStream;
}

import type OpenAI from "openai";
import type { DrawingRequest } from "../src/lib/contracts";
import { DRAWING_PROMPT, EDIT_PROMPT } from "./prompts";

/** Build provider messages from validated input. Provider settings stay outside prompts. */
export function drawingMessages(
  input: DrawingRequest,
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
    {
      type: "text",
      text: `${input.instruction}\n${input.svg ? `Current SVG:\n${input.svg}\nSelected element: ${input.selectedId || "none; whole-drawing edit permitted"}` : ""}\nExisting user-supplied manufacturing notes: ${JSON.stringify(input.notes)}`,
    },
  ];
  if (input.image)
    content.push({
      type: "image_url",
      image_url: { url: input.image, detail: "high" },
    });
  const continuation: OpenAI.Chat.Completions.ChatCompletionMessageParam[] =
    input.toolTurns.flatMap((turn) => [
      {
        role: "assistant" as const,
        content: turn.content || null,
        tool_calls: turn.calls.map((call) => ({
          id: call.id,
          type: "function" as const,
          function: { name: "request_user_input", arguments: call.arguments },
        })),
      },
      ...turn.calls.map((call, i) => ({
        role: "tool" as const,
        tool_call_id: call.id,
        content: JSON.stringify(turn.responses[i]),
      })),
    ]);
  return [
    {
      role: "system",
      content: input.mode === "edit" ? EDIT_PROMPT : DRAWING_PROMPT,
    },
    ...input.history.map((message) => ({
      role: message.role,
      content: message.text,
    })),
    { role: "user", content },
    ...continuation,
  ];
}

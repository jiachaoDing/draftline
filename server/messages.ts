import type OpenAI from "openai";
import type { DrawingRequest } from "../src/lib/contracts";
import { DRAWING_PROMPT, EDIT_PROMPT, SOURCE_EDIT_PROMPT } from "./prompts";

/** Build provider messages from validated input. Provider settings stay outside prompts. */
export function drawingMessages(
  input: DrawingRequest,
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
    {
      type: "text",
      text: `${input.instruction}\n${input.source ? `Virtual source: drawing.html\nRevision: ${input.source.revision}\nLines: ${input.source.html.split("\n").length}\nSelected element: ${input.selectedId || "none; whole-drawing edit permitted"}\nUse read_source/search_source to inspect the source.` : input.svg ? `Current SVG:\n${input.svg}\nSelected element: ${input.selectedId || "none; whole-drawing edit permitted"}` : ""}\nExisting user-supplied manufacturing notes: ${JSON.stringify(input.notes)}`,
    },
  ];
  if (input.image)
    content.push({
      type: "image_url",
      image_url: { url: input.image, detail: "high" },
    });
  const questions = input.toolTurns.map((turn) => [
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
  const continuation: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
  for (let round = 0; round <= questions.length; round++) {
    for (const turn of input.agentTurns.filter(
      (turn) => turn.questionRound === round,
    )) {
      continuation.push({
        role: "assistant",
        content: turn.content || null,
        tool_calls: turn.calls.map((call) => ({
          id: call.id,
          type: "function",
          function: { name: call.name, arguments: call.arguments },
        })),
      });
      continuation.push(
        ...turn.calls.map((call, i) => ({
          role: "tool" as const,
          tool_call_id: call.id,
          content: turn.results[i],
        })),
      );
    }
    if (round < questions.length) continuation.push(...questions[round]);
  }
  return [
    {
      role: "system",
      content:
        input.mode === "edit"
          ? input.source
            ? SOURCE_EDIT_PROMPT
            : EDIT_PROMPT
          : DRAWING_PROMPT,
    },
    ...input.history.map((message) => ({
      role: message.role,
      content: message.text,
    })),
    { role: "user", content },
    ...continuation,
  ];
}

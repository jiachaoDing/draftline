import type { ServerResponse } from "node:http";

export function openCompletion(res: ServerResponse) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-store",
  });
}
export function contentChunk(res: ServerResponse, content: string) {
  res.write(
    `data: ${JSON.stringify({ id: "stream-fixture", object: "chat.completion.chunk", created: 0, model: "vision-test", choices: [{ index: 0, delta: { content }, finish_reason: null }] })}\n\n`,
  );
}
export function finishCompletion(res: ServerResponse, reason = "stop") {
  res.write(
    `data: ${JSON.stringify({ id: "stream-fixture", object: "chat.completion.chunk", created: 0, model: "vision-test", choices: [{ index: 0, delta: {}, finish_reason: reason }] })}\n\n`,
  );
  res.end("data: [DONE]\n\n");
}
export function completeResponse(res: ServerResponse, content: string) {
  openCompletion(res);
  for (let offset = 0; offset < content.length; offset += 71)
    contentChunk(res, content.slice(offset, offset + 71));
  finishCompletion(res);
}

export function toolResponse(
  res: ServerResponse,
  calls: { id: string; arguments: string; name?: string }[],
  reason = "tool_calls",
) {
  openCompletion(res);
  const chunk = (tool_calls: unknown[]) =>
    res.write(
      `data: ${JSON.stringify({
        id: "tool-fixture",
        object: "chat.completion.chunk",
        created: 0,
        model: "vision-test",
        choices: [{ index: 0, delta: { tool_calls }, finish_reason: null }],
      })}\n\n`,
    );
  calls.forEach((call, index) =>
    chunk([
      {
        index,
        id: call.id,
        type: "function",
        function: { name: call.name || "request_user_input", arguments: "" },
      },
    ]),
  );
  // Interleave calls and split JSON in the middle of strings and Unicode text.
  for (
    let offset = 0;
    offset < Math.max(...calls.map((call) => call.arguments.length));
    offset += 9
  )
    calls.forEach((call, index) => {
      if (offset < call.arguments.length)
        chunk([
          {
            index,
            function: { arguments: call.arguments.slice(offset, offset + 9) },
          },
        ]);
    });
  finishCompletion(res, reason);
}

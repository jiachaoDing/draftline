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

// @vitest-environment node
import { createServer } from "node:http";
import { expect, it } from "vitest";
import { createProvider } from "../server/provider";
import { modelStream } from "../server/model-stream";
import { completeResponse } from "./helpers/provider-stream";

it("streams through the AI SDK compatible provider", async () => {
  const server = createServer(async (request, response) => {
    for await (const _chunk of request) {
      /* consume */
    }
    completeResponse(response, "OK");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const client = createProvider(
      {
        baseURL: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`,
        apiKey: "fixture-key",
        model: "fixture",
        reasoningEffort: "auto",
      },
      true,
    );
    const events = [];
    for await (const event of modelStream(
      client,
      { model: "fixture", messages: [{ role: "user", content: "OK" }] },
      new AbortController().signal,
    )) {
      if (event.type === "error") throw event.error;
      events.push(event.type);
    }
    expect(events).toContain("text-delta");
    expect(events.at(-1)).toBe("finish");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it.each(['{"file_path": "drawing.html"}', "{invalid tool JSON"])(
  "preserves original tool arguments and corrective feedback on continuation: %s",
  async (argumentsText) => {
    let seen: any;
    const server = createServer(async (request, response) => {
      let body = "";
      for await (const chunk of request) body += chunk;
      seen = JSON.parse(body);
      completeResponse(response, "Corrected");
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    try {
      const client = createProvider(
        {
          baseURL: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`,
          apiKey: "fixture",
          model: "fixture",
          reasoningEffort: "auto",
        },
        true,
      );
      for await (const event of modelStream(
        client,
        {
          model: "fixture",
          messages: [
            { role: "user", content: "Inspect drawing" },
            {
              role: "assistant",
              tool_calls: [
                {
                  id: "read",
                  type: "function",
                  function: { name: "read_source", arguments: argumentsText },
                },
              ],
            },
            {
              role: "tool",
              tool_call_id: "read",
              content: '{"ok":false,"error":"Correct the arguments"}',
            },
          ],
        },
        new AbortController().signal,
      )) {
        if (event.type === "error") throw event.error;
      }
      expect(seen.messages[1].tool_calls[0].function.arguments).toBe(
        argumentsText,
      );
      expect(seen.messages[2]).toMatchObject({
        role: "tool",
        tool_call_id: "read",
        content: '{"ok":false,"error":"Correct the arguments"}',
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);

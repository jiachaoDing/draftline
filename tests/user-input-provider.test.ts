// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { createApp } from "../server/app";
import { readAIStream } from "../src/lib/stream";
import {
  userInputResultSchema,
  type DrawingResult,
} from "../src/lib/contracts";
import { completeResponse, toolResponse } from "./helpers/provider-stream";

const args = {
  questions: [
    {
      id: "width",
      header: "Width",
      question: "宽度是多少毫米？",
      options: [
        {
          label: "120 mm (Recommended)",
          description: "Use your proposed width.",
        },
        { label: "Specify width", description: "Enter an exact dimension." },
      ],
    },
  ],
};
const calls = [{ id: "call_width", arguments: JSON.stringify(args) }];
const app = createApp(true);
let server: Server;
let baseURL: string;
let seen: any;
beforeAll(async () => {
  server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const input = JSON.parse(body);
    seen = input;
    const instruction = input.messages.findLast((m: any) => m.role === "user")
      .content[0].text;
    if (input.messages.at(-1).role === "tool") {
      completeResponse(res, '{"kind":"message","message":"Drawing resumed"}');
      return;
    }
    if (instruction.includes("malformed"))
      toolResponse(res, [{ ...calls[0], arguments: '{"questions":[]}' }]);
    else if (instruction.includes("unknown"))
      toolResponse(res, [{ ...calls[0], name: "run_code" }]);
    else if (instruction.includes("truncated"))
      toolResponse(res, calls, "length");
    else if (instruction.includes("duplicate"))
      toolResponse(res, [calls[0], calls[0]]);
    else
      toolResponse(
        res,
        instruction.includes("batch")
          ? [calls[0], { ...calls[0], id: "call_2" }]
          : calls,
      );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseURL = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
const draw = (input: Record<string, unknown> = {}) =>
  app.request("http://app.test/api/draw", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      config: { baseURL, apiKey: "test-key", model: "vision-test" },
      mode: "generate",
      instruction: "Draw a plate",
      ...input,
    }),
  });
describe("streamed request_user_input tool round trips", () => {
  it("assembles fragmented Unicode arguments and returns the original tool call IDs", async () => {
    const result = await readAIStream<DrawingResult>(await draw());
    expect(userInputResultSchema.parse(result)).toEqual({
      kind: "request_user_input",
      content: "",
      calls,
    });
    expect(seen.tools[0].function.name).toBe("request_user_input");
    expect(seen.parallel_tool_calls).toBe(false);
    expect(seen.stream).toBe(true);
  });
  it("resumes with assistant/tool messages, preserving selected SVG, image, history and all prior rounds", async () => {
    const response = {
      answers: {
        width: { answers: ["None of the above", "user_note: 123 mm"] },
      },
    };
    const turn = {
      content: "Please specify width",
      calls,
      responses: [response],
    };
    const secondTurn = { ...turn, calls: [{ ...calls[0], id: "call_second" }] };
    const result = await readAIStream(
      await draw({
        mode: "edit",
        svg: "<svg>current</svg>",
        selectedId: "hole",
        image: "data:image/png;base64,YQ==",
        history: [{ role: "user", text: "Earlier context" }],
        toolTurns: [turn, secondTurn],
      }),
    );
    expect(result).toEqual({ kind: "message", message: "Drawing resumed" });
    expect(seen.messages[1]).toEqual({
      role: "user",
      content: "Earlier context",
    });
    expect(seen.messages[2].content[0].text).toContain(
      "Selected element: hole",
    );
    expect(seen.messages[2].content[1].image_url.url).toBe(
      "data:image/png;base64,YQ==",
    );
    expect(seen.messages[3]).toEqual({
      role: "assistant",
      content: turn.content,
      tool_calls: [
        {
          id: "call_width",
          type: "function",
          function: {
            name: "request_user_input",
            arguments: calls[0].arguments,
          },
        },
      ],
    });
    expect(seen.messages[4]).toEqual({
      role: "tool",
      tool_call_id: "call_width",
      content: JSON.stringify(response),
    });
    expect(seen.messages[6].tool_call_id).toBe("call_second");
  });
  it("retains interleaved parallel calls for the client's sequential queue", async () => {
    const result = userInputResultSchema.parse(
      await readAIStream(await draw({ instruction: "batch" })),
    );
    expect(result.calls.map((call) => call.id)).toEqual([
      "call_width",
      "call_2",
    ]);
  });
  it.each(["malformed", "unknown", "truncated", "duplicate"])(
    "rejects %s tool streams without a successful result",
    async (instruction) => {
      await expect(readAIStream(await draw({ instruction }))).rejects.toThrow(
        /tool|token limit|questions/,
      );
    },
  );
  it("rejects missing tool results before requesting the provider", async () => {
    expect(
      (await draw({ toolTurns: [{ content: "", calls, responses: [] }] }))
        .status,
    ).toBe(400);
  });
});

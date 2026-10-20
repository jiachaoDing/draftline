// @vitest-environment node
import { describe, expect, it } from "vitest";
import { drawingMessages } from "../server/messages";
import { drawingRequestSchema } from "../src/lib/contracts";
import { DRAWING_PROMPT, EDIT_PROMPT } from "../server/prompts";

const args = JSON.stringify({
  questions: [
    {
      id: "width",
      header: "Width",
      question: "Width?",
      options: [{ label: "120 mm", description: "Proposed width" }],
    },
  ],
});
const config = {
  baseURL: "https://private-provider.example/v1",
  apiKey: "secret-never-in-prompts",
  model: "private-model-id",
};

describe("provider message construction", () => {
  it("sends attachment metadata without default source, image or PDF injection", () => {
    const input = drawingRequestSchema.parse({
      config,
      mode: "generate",
      instruction: "Inspect these references",
      attachments: [
        {
          id: "pdf",
          type: "pdf",
          name: "sheet.pdf",
          size: 8,
          file: "data:application/pdf;base64,JVBERg==",
        },
        {
          id: "svg",
          type: "svg",
          name: "drawing.svg",
          size: 6,
          text: "<svg/>",
        },
        { id: "dxf", type: "dxf", name: "part.dxf", size: 5, text: "ENTITIES" },
        {
          id: "png",
          type: "image",
          name: "sketch.png",
          size: 4,
          image: "data:image/png;base64,AAAA",
        },
      ],
    });
    const content = drawingMessages(input).at(-1)!.content;
    expect(JSON.stringify(content)).not.toContain("file_data");
    expect(JSON.stringify(content)).not.toContain("image_url");
    expect(JSON.stringify(content)).not.toContain("ENTITIES");
    expect(JSON.stringify(content)).not.toContain("<svg/>");
    expect(JSON.stringify(content)).toContain("sheet.pdf");
    expect(JSON.stringify(content)).toContain("drawing.svg");
    expect(JSON.stringify(content)).not.toContain(config.apiKey);
    const next = drawingMessages({ ...input, attachments: [] });
    expect(JSON.stringify(next)).not.toContain("file_data");
    expect(JSON.stringify(next)).not.toContain("image_url");
  });
  it("attaches a selected-page visual only after tool access, preserving matching calls/results", () => {
    const input = drawingRequestSchema.parse({
      config,
      mode: "generate",
      instruction: "Inspect",
      resources: [],
      agentTurns: [
        {
          questionRound: 0,
          content: "",
          calls: [
            {
              id: "preview",
              name: "inspect_resource",
              arguments: '{"resource_id":"pdf","preview":true,"page":2}',
            },
          ],
          results: ['{"ok":true}'],
          previews: [
            {
              resourceId: "pdf",
              name: "sheet.pdf",
              page: 2,
              image: "data:image/png;base64,AAAA",
            },
          ],
        },
      ],
    });
    const messages = drawingMessages(input);
    expect(messages[3]).toMatchObject({
      role: "tool",
      tool_call_id: "preview",
    });
    expect(messages[4]).toMatchObject({
      role: "user",
      content: [
        { type: "text", text: expect.stringContaining("page 2") },
        { type: "image_url" },
      ],
    });
    expect(JSON.stringify(messages)).not.toContain("file_data");
  });
  it("requests localized replies and questions without changing source context or tool contracts", () => {
    for (const language of ["en", "zh-CN"] as const) {
      const input = drawingRequestSchema.parse({
        config,
        mode: "generate",
        instruction: "板件宽 120 mm",
        language,
      });
      const messages = drawingMessages(input);
      expect(messages[0].content).toContain(
        language === "zh-CN" ? "Simplified Chinese" : "English",
      );
      expect(messages[0].content).toContain(
        "Keep JSON keys and tool names unchanged",
      );
      expect(JSON.stringify(messages)).toContain("板件宽 120 mm");
      expect(JSON.stringify(messages)).not.toContain(config.apiKey);
    }
    expect(
      drawingRequestSchema.safeParse({
        config,
        mode: "generate",
        instruction: "Draw",
        language: "invalid",
      }).success,
    ).toBe(false);
  });
  it("keeps credentials and settings outside prompts while carrying the sketch and drawing context", () => {
    const input = drawingRequestSchema.parse({
      config,
      mode: "edit",
      instruction: "Resize hole",
      svg: "current-svg",
      selectedId: "hole",
      notes: ["Material: steel"],
      image: "data:image/png;base64,AA==",
      history: [{ role: "assistant", text: "Previous answer" }],
    });
    const messages = drawingMessages(input);
    expect(messages[0]).toEqual({
      role: "system",
      content: expect.stringContaining(EDIT_PROMPT),
    });
    expect(messages[1]).toEqual({
      role: "assistant",
      content: "Previous answer",
    });
    expect(messages[2]).toEqual({
      role: "user",
      content: [
        {
          type: "text",
          text: 'Resize hole\nCurrent SVG:\ncurrent-svg\nSelected element: hole\nExisting user-supplied manufacturing notes: ["Material: steel"]',
        },
        { type: "image_url", image_url: { url: input.image, detail: "high" } },
      ],
    });
    for (const setting of Object.values(config))
      expect(JSON.stringify(messages)).not.toContain(setting);
  });

  it("preserves exact assistant calls and matching tool results through multiple rounds", () => {
    const input = drawingRequestSchema.parse({
      config,
      mode: "generate",
      instruction: "Draw",
      toolTurns: [
        {
          content: "",
          calls: [
            { id: "first", arguments: args },
            { id: "second", arguments: args },
          ],
          responses: [
            { answers: { width: { answers: ["120 mm"] } } },
            { answers: { width: { answers: [] } } },
          ],
        },
        {
          content: "Confirm",
          calls: [{ id: "follow-up", arguments: args }],
          responses: [{ answers: { width: { answers: ["140 mm"] } } }],
        },
      ],
    });
    const messages = drawingMessages(input);
    expect(messages[0]).toEqual({
      role: "system",
      content: expect.stringContaining(DRAWING_PROMPT),
    });
    expect(messages.map((m) => m.role)).toEqual([
      "system",
      "user",
      "assistant",
      "tool",
      "tool",
      "assistant",
      "tool",
    ]);
    expect(messages[2]).toMatchObject({
      content: null,
      tool_calls: [
        {
          id: "first",
          type: "function",
          function: { name: "request_user_input", arguments: args },
        },
        {
          id: "second",
          type: "function",
          function: { name: "request_user_input", arguments: args },
        },
      ],
    });
    expect(messages[4]).toEqual({
      role: "tool",
      tool_call_id: "second",
      content: JSON.stringify(input.toolTurns[0].responses[1]),
    });
    expect(messages[6]).toEqual({
      role: "tool",
      tool_call_id: "follow-up",
      content: JSON.stringify(input.toolTurns[1].responses[0]),
    });
  });
});

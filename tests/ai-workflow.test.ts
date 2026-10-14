import { describe, expect, it } from "vitest";
import {
  conversationHistory,
  drawingChange,
  drawingContext,
} from "../src/lib/ai-workflow";
import type { AIResult, ChatMessage } from "../src/lib/contracts";
import { EXAMPLE } from "../src/lib/example";
import { sanitizeSVG } from "../src/lib/drawing";

const complete: Extract<AIResult, { kind: "drawing" }> = {
  kind: "drawing",
  title: "New plate",
  summary: "Updated",
  notes: [],
  html: `${EXAMPLE.svg}<script>document.querySelector('circle').setAttribute('r','7')</script>`,
};

describe("drawing request and commit boundaries", () => {
  it("bounds completed history and excludes interrupted or unvalidated responses", () => {
    const messages: ChatMessage[] = Array.from({ length: 15 }, (_, i) => ({
      role: "user",
      text: String(i),
    }));
    for (const status of [
      "streaming",
      "validating",
      "error",
      "cancelled",
    ] as const)
      messages.push({ role: "assistant", text: "Do not send", status });
    messages.push({
      role: "assistant",
      text: "x".repeat(9000),
      status: "complete",
      code: "private display",
      reference: { name: "ref", data: "image" },
    });
    const history = conversationHistory(messages);
    expect(history).toHaveLength(10);
    expect(history[0].text).toBe("6");
    expect(history.at(-1)).toEqual({
      role: "assistant",
      text: "x".repeat(8000),
    });
    expect(history.some((m) => m.text === "Do not send")).toBe(false);
  });

  it("preserves the original drawing, selection and sketch when answering a clarification", () => {
    const original = drawingContext(
      "Resize",
      [],
      EXAMPLE,
      "original-image",
      "hole-top-left",
    );
    const resumed = drawingContext(
      "Width 140 mm",
      [],
      null,
      "different-image",
      undefined,
      original,
    );
    expect(resumed).toEqual({
      ...original,
      instruction: "Resize\nUser clarification: Width 140 mm",
    });
    expect(original.instruction).toBe("Resize");
    expect(drawingContext("Create", [], null).mode).toBe("generate");
  });

  it("keeps full HTML as an unexecuted candidate without changing the drawing", () => {
    const before = structuredClone(EXAMPLE);
    const change = drawingChange(
      complete,
      drawingContext("Resize", [], EXAMPLE),
      EXAMPLE,
    );
    expect(change.kind).toBe("validate");
    if (change.kind === "validate") {
      expect(change.candidate.html).toContain("<script>");
      expect(change.candidate).not.toHaveProperty("svg");
    }
    expect(EXAMPLE).toEqual(before);
  });

  it("rejects a whole-drawing replacement while an element is selected", () => {
    expect(() =>
      drawingChange(
        complete,
        drawingContext("Change hole", [], EXAMPLE, undefined, "hole-top-left"),
        EXAMPLE,
      ),
    ).toThrow("whole drawing during a selected edit");
  });

  it("applies a targeted patch to the request snapshot, retaining metadata and unrelated geometry", () => {
    const input = drawingContext(
      "Resize hole",
      [],
      EXAMPLE,
      undefined,
      "hole-top-left",
    );
    const result: Extract<AIResult, { kind: "patch" }> = {
      kind: "patch",
      summary: "Hole updated",
      patches: [
        {
          id: "hole-top-left",
          svg: '<circle id="hole-top-left" cx="20" cy="20" r="7" />',
        },
      ],
    };
    const change = drawingChange(result, input, {
      ...EXAMPLE,
      notes: ["Material: steel"],
    });
    expect(change.kind).toBe("commit");
    if (change.kind !== "commit") return;
    const svg = sanitizeSVG(change.drawing.svg);
    expect(svg.querySelector("#hole-top-left")!.getAttribute("r")).toBe("7");
    expect(svg.querySelector("#hole-top-right")!.getAttribute("r")).toBe("5");
    expect(change.drawing.notes).toEqual(["Material: steel"]);
    expect(change.drawing.title).toBe(EXAMPLE.title);
    expect(() =>
      drawingChange(result, { ...input, selectedId: undefined }, EXAMPLE),
    ).toThrow("without a selected element");
    expect(() =>
      drawingChange(
        {
          ...result,
          patches: [{ ...result.patches[0], id: "hole-top-right" }],
        },
        input,
        EXAMPLE,
      ),
    ).toThrow("unrelated element");
  });
});

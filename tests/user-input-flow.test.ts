import { describe, expect, it } from "vitest";
import { drawingContext } from "../src/lib/ai-workflow";
import { answerQuestions, pendingQuestions } from "../src/lib/user-input-flow";
import {
  pendingUserInputSchema,
  drawingRequestSchema,
  type DrawingResult,
} from "../src/lib/contracts";

const args = JSON.stringify({
  questions: [
    {
      id: "width",
      header: "Width",
      question: "Width in mm?",
      options: [{ label: "120 mm", description: "Proposed width" }],
    },
  ],
});
const request: Extract<DrawingResult, { kind: "request_user_input" }> = {
  kind: "request_user_input",
  content: "Need measurements",
  calls: [
    { id: "call_a", arguments: args },
    { id: "call_b", arguments: args },
  ],
};
const response = {
  answers: { width: { answers: ["140 mm", "user_note: Keep R8"] } },
};

describe("persistable clarification continuation", () => {
  it("queues calls and resumes once all answers exist, retaining IDs, order and context", () => {
    const context = drawingContext(
      "Draw a plate",
      [],
      null,
      "data:image/png;base64,AA==",
    );
    const pending = pendingQuestions(context, request);
    const before = structuredClone(pending);
    const next = answerQuestions(pending, response);
    expect(next.kind).toBe("next");
    expect(pending).toEqual(before);
    if (next.kind !== "next") return;
    const restored = pendingUserInputSchema.parse(next.pending);
    expect(restored.callIndex).toBe(1);
    expect(restored.state.answers[0].committed).toBe(false);
    const resumed = answerQuestions(restored, {
      answers: { width: { answers: [] } },
    });
    expect(resumed.kind).toBe("resume");
    if (resumed.kind !== "resume") return;
    expect(resumed.context.image).toBe(context.image);
    expect(resumed.context.toolTurns[0]).toEqual({
      content: request.content,
      calls: request.calls,
      responses: [response, { answers: { width: { answers: [] } } }],
    });
    expect(resumed.message.id).toBe("tool-answer:call_a:call_b");
    expect(resumed.message.text).toContain("140 mm\nuser_note: Keep R8");
    expect(resumed.message.text).toContain("Unanswered");
    expect(
      drawingRequestSchema.safeParse({
        ...resumed.context,
        config: {
          baseURL: "https://api.example/v1",
          apiKey: "key",
          model: "vision",
        },
      }).success,
    ).toBe(true);
  });

  it("allows retry with the same pending request and protects the clarification round limit", () => {
    const pending = pendingQuestions(drawingContext("Draw", [], null), {
      ...request,
      calls: [request.calls[0]],
    });
    const first = answerQuestions(pending, response);
    expect(answerQuestions(pending, response)).toEqual(first);
    expect(pending.responses).toEqual([]);
    if (first.kind !== "resume") return;
    pending.context.toolTurns = Array.from(
      { length: 11 },
      () => first.context.toolTurns[0],
    );
    expect(answerQuestions(pending, response).kind).toBe("resume");
    pending.context.toolTurns.push(first.context.toolTurns[0]);
    expect(() => answerQuestions(pending, response)).toThrow(
      "clarification limit",
    );
  });
});

import { describe, expect, it, vi } from "vitest";
import {
  runDrawingAgent,
  DrawingAgentRecoveryError,
} from "../src/lib/drawing-agent";
import { ModelFailure } from "../src/lib/model-failure";
import { drawingContext } from "../src/lib/ai-workflow";
import { EXAMPLE } from "../src/lib/example";
import { cleanDrawing, serialize } from "../src/lib/drawing";
import type { DrawingRequest, DrawingResult } from "../src/lib/contracts";
import { drawingRequestSchema } from "../src/lib/contracts";
import { radiusPatch } from "./helpers/source-patch";

const config = {
  baseURL: "https://example.com/v1",
  apiKey: "secret-key",
  model: "test",
};
const call = (id: string, name: string, args: unknown): DrawingResult => ({
  kind: "tool_calls",
  content: "",
  calls: [{ id, name, arguments: JSON.stringify(args) }],
});
const invalid = () =>
  new ModelFailure("The model returned invalid JSON.", {
    code: "invalid_json",
    retryable: true,
    diagnostic: { category: "plain_text", length: 10 },
  });
const finish = (input: DrawingRequest) =>
  call("done", "finish_drawing", {
    revision: input.source!.revision,
    summary: "Finished",
  });
function setup(
  terminal: (input: DrawingRequest) => Promise<DrawingResult> | DrawingResult,
) {
  const validate = vi.fn(async (html: string) =>
    cleanDrawing(
      serialize(
        new DOMParser()
          .parseFromString(html, "text/html")
          .querySelector("svg")!,
      ),
    ),
  );
  const request = vi.fn(
    async (input: DrawingRequest): Promise<DrawingResult> => {
      drawingRequestSchema.parse(input);
      if (!input.agentTurns.length)
        return call("read", "read_source", { file_path: "drawing.html" });
      if (input.agentTurns.length === 1)
        return call("patch", "apply_patch", {
          revision: input.source!.revision,
          patch: radiusPatch(input.source!.html, "hole-top-left", "7"),
        });
      return terminal(input);
    },
  );
  return {
    projectId: "project-a",
    context: drawingContext("Resize", [], EXAMPLE),
    drawing: EXAMPLE,
    config,
    signal: new AbortController().signal,
    request,
    validate,
    isCurrent: () => true,
    onDelta: () => {},
    onRound: () => {},
  };
}
async function failedCheckpoint() {
  const options = setup(() => {
    throw invalid();
  });
  const error = await runDrawingAgent(options).catch((error) => error);
  expect(error).toBeInstanceOf(DrawingAgentRecoveryError);
  return {
    options,
    checkpoint: (error as DrawingAgentRecoveryError).checkpoint,
  };
}

describe("failed model round recovery", () => {
  it("recovers invalid final JSON with explicit completion without repeating successful edits", async () => {
    let attempts = 0;
    const options = setup((input) => {
      if (!attempts++) throw invalid();
      return finish(input);
    });
    const outcome = await runDrawingAgent(options);
    expect(options.request).toHaveBeenCalledTimes(4);
    expect(options.validate).toHaveBeenCalledTimes(1);
    const failedInput = options.request.mock.calls[2][0];
    const retriedInput = options.request.mock.calls[3][0];
    expect(retriedInput.source).toEqual(failedInput.source);
    expect(retriedInput.agentTurns).toEqual(failedInput.agentTurns);
    expect(
      retriedInput.agentTurns.flatMap((turn) => turn.calls.map((c) => c.id)),
    ).toEqual(["read", "patch"]);
    expect(retriedInput.recovering).toBe(true);
    expect(outcome.drawing?.svg).toContain('r="7"');
    expect(outcome.drawing?.summary).toBe("Finished");
    expect(EXAMPLE.svg).toContain('r="5"');
  });

  it("bounds automatic recovery, preserves the original and resumes only the failed round", async () => {
    const { options, checkpoint } = await failedCheckpoint();
    expect(options.request).toHaveBeenCalledTimes(5);
    expect(options.validate).toHaveBeenCalledTimes(1);
    expect(EXAMPLE.svg).toContain('r="5"');
    expect(checkpoint.session?.drawing.svg).toContain('r="7"');
    expect(checkpoint.session?.source.revision).toBe(
      checkpoint.context.source?.revision,
    );
    expect(JSON.stringify(checkpoint)).not.toContain(config.apiKey);
    const request = vi.fn(async (input: DrawingRequest) => finish(input));
    const resumed = await runDrawingAgent({
      ...options,
      recovery: checkpoint,
      request,
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(options.validate).toHaveBeenCalledTimes(1);
    expect(resumed.drawing?.svg).toContain('r="7"');
  });

  it("leaves the original unchanged if manual continuation also fails", async () => {
    const { options, checkpoint } = await failedCheckpoint();
    const request = vi.fn(async () => {
      throw new ModelFailure("Connection interrupted", {
        code: "connection",
        retryable: true,
      });
    });
    await expect(
      runDrawingAgent({ ...options, recovery: checkpoint, request }),
    ).rejects.toBeInstanceOf(DrawingAgentRecoveryError);
    expect(request).toHaveBeenCalledTimes(3);
    expect(options.validate).toHaveBeenCalledTimes(1);
    expect(EXAMPLE.svg).toContain('r="5"');
  });

  it("rejects changed base revisions and foreign projects before sending a request", async () => {
    const { options, checkpoint } = await failedCheckpoint();
    for (const change of [
      { projectId: "project-b" },
      { drawing: { ...EXAMPLE, revision: "new-revision" } },
      { isCurrent: () => false },
    ]) {
      const request = vi.fn();
      await expect(
        runDrawingAgent({
          ...options,
          ...change,
          recovery: checkpoint,
          request,
        }),
      ).rejects.toThrow("Revision conflict");
      expect(request).not.toHaveBeenCalled();
    }
  });

  it("does not replay a previously successful call ID after continuation", async () => {
    const { options, checkpoint } = await failedCheckpoint();
    await expect(
      runDrawingAgent({
        ...options,
        recovery: checkpoint,
        request: async () =>
          call("patch", "apply_patch", {
            revision: checkpoint.session!.source.revision,
            patch: "ignored",
          }),
      }),
    ).rejects.toThrow("reused a tool call ID");
    expect(options.validate).toHaveBeenCalledTimes(1);
  });

  it("requires a valid, isolated completion tool for the current staged revision", async () => {
    let attempts = 0;
    const options = setup((input) => {
      if (!attempts++)
        return call("stale", "finish_drawing", {
          revision: "old",
          summary: "Done",
        });
      if (attempts === 2)
        return {
          kind: "tool_calls",
          content: "",
          calls: [
            {
              id: "mixed",
              name: "finish_drawing",
              arguments: JSON.stringify({
                revision: input.source!.revision,
                summary: "Done",
              }),
            },
            { id: "mutation", name: "transform_object", arguments: "{}" },
          ],
        };
      return finish(input);
    });
    expect((await runDrawingAgent(options)).drawing?.summary).toBe("Finished");
    expect(options.validate).toHaveBeenCalledTimes(1);
  });

  it("does not automatically resume a cancelled round or retain a cancellation checkpoint", async () => {
    const controller = new AbortController();
    const options = setup(() => {
      controller.abort();
      throw invalid();
    });
    await expect(
      runDrawingAgent({ ...options, signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(options.request).toHaveBeenCalledTimes(3);
    expect(options.validate).toHaveBeenCalledTimes(1);
    expect(EXAMPLE.svg).toContain('r="5"');
  });
});

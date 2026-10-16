// Adapted control flow: Codex records calls/results, then samples again until
// no follow-up tool work remains. See third_party/codex/apply-patch/README.md.
import type { DrawingContext } from "./ai-workflow";
import { drawingRevision } from "./ai-workflow";
import { agentCallsResultSchema, type AgentTurn } from "./agent-contracts";
import type {
  Drawing,
  DrawingRequest,
  DrawingResult,
  ModelConfig,
} from "./contracts";
import {
  DrawingToolSession,
  type SourceValidator,
} from "./drawing-tool-session";
import { formatDrawingSource } from "./format-source";
import { svgToHTML } from "./drawing";
import {
  toolPendingSchema,
  type ActivityHandler,
  type ToolPending,
} from "./agent-activity";

type AgentOptions = {
  context: DrawingContext;
  config: ModelConfig;
  drawing: Drawing | null;
  signal: AbortSignal;
  request: (
    input: DrawingRequest,
    signal: AbortSignal,
    delta: (text: string) => void,
    pending?: (event: ToolPending) => void,
  ) => Promise<DrawingResult>;
  validate: SourceValidator;
  isCurrent: () => boolean;
  onDelta: (text: string) => void;
  onRound: () => void;
  onActivity?: ActivityHandler;
};
export async function runDrawingAgent(options: AgentOptions): Promise<{
  result: DrawingResult;
  context: DrawingContext;
  drawing?: Drawing;
}> {
  const { signal, drawing } = options;
  const emit: ActivityHandler = (activity) => {
    let detail = activity.detail;
    if (detail) {
      for (const secret of [options.config.apiKey, options.config.baseURL])
        if (secret) detail = detail.split(secret).join("[redacted]");
    }
    options.onActivity?.({ ...activity, detail: detail?.slice(0, 2000) });
  };
  let context = {
    ...options.context,
    agentTurns: options.context.agentTurns || [],
    toolTurns: options.context.toolTurns || [],
  };
  let session: DrawingToolSession | undefined;
  if (context.source && drawing) {
    if (
      context.source.revision !== drawingRevision(drawing) ||
      !options.isCurrent()
    )
      throw new Error(
        "Revision conflict: the drawing changed while questions were pending. Cancel questions and start a new request.",
      );
    emit({ id: "prepare", kind: "prepare", status: "running" });
    const html = await formatDrawingSource(svgToHTML(drawing.svg));
    signal.throwIfAborted();
    emit({
      id: "prepare",
      kind: "prepare",
      status: "completed",
      detail: "Versioned drawing.html is ready for inspection.",
    });
    session = new DrawingToolSession(
      { ...context.source, html },
      drawing,
      options.validate,
      options.isCurrent,
    );
  }
  const ids = new Set([
    ...context.agentTurns.flatMap((turn) => turn.calls.map((c) => c.id)),
    ...context.toolTurns.flatMap((turn) => turn.calls.map((c) => c.id)),
  ]);
  let round = 0;
  while (true) {
    signal.throwIfAborted();
    if (!options.isCurrent())
      throw new Error(
        "Revision conflict: the committed drawing changed. Start a new request.",
      );
    if (session) context = { ...context, source: session.source };
    options.onRound();
    const modelId = `model:${round}`;
    const toolId = (index: number) => `tool:${round}:${index}`;
    emit({ id: modelId, kind: "model", status: "running" });
    const result = await options.request(
      { ...context, config: options.config },
      signal,
      options.onDelta,
      ({ index, name }) => {
        if (!signal.aborted)
          emit({
            id: toolId(index),
            kind: name,
            status: "pending",
            detail:
              "The model is preparing tool arguments. Execution starts after a successful complete response.",
          });
      },
    );
    signal.throwIfAborted();
    emit({
      id: modelId,
      kind: "model",
      status: "completed",
      detail: "Received a successful complete model response.",
    });
    if (!options.isCurrent())
      throw new Error(
        "Revision conflict: the committed drawing changed. Start a new request.",
      );
    if (
      result.kind !== "tool_calls" &&
      !(result.kind === "request_user_input" && session?.changed)
    ) {
      if (
        result.kind === "request_user_input" &&
        result.calls.some((c) => ids.has(c.id))
      )
        throw new Error(
          "The model reused a tool call ID. Start a new request.",
        );
      if (session?.changed) {
        if (result.kind !== "message" || session.patchFailed)
          throw new Error(
            "The edit was not completed successfully. Your drawing is unchanged.",
          );
        return {
          result,
          context,
          drawing: {
            ...session.drawing,
            summary: result.message.slice(0, 3000),
          },
        };
      }
      if (result.kind === "request_user_input") {
        result.calls.forEach((_call, index) =>
          emit({
            id: toolId(index),
            kind: "request_user_input",
            status: "completed",
            detail: "Measurement questions are ready for your answers.",
          }),
        );
      }
      return { result, context };
    }
    if (!session) throw new Error("Source tools require an existing drawing.");
    const toolResult =
      result.kind === "tool_calls"
        ? agentCallsResultSchema.parse(result)
        : {
            content: result.content,
            calls: result.calls.map((c) => ({
              ...c,
              name: "request_user_input",
            })),
          };
    if (context.agentTurns.length >= 16)
      throw new Error(
        "The drawing reached its tool-round limit. Your drawing is unchanged; start a new request.",
      );
    const results: string[] = [];
    toolResult.calls.forEach((call, index) => {
      const kind = toolPendingSchema.shape.name.safeParse(call.name);
      emit({
        id: toolId(index),
        kind: kind.success ? kind.data : "tool",
        status: "pending",
      });
    });
    for (const [index, call] of toolResult.calls.entries()) {
      if (ids.has(call.id))
        throw new Error(
          "The model reused a tool call ID. Your drawing is unchanged.",
        );
      ids.add(call.id);
      signal.throwIfAborted();
      const kind = toolPendingSchema.shape.name.safeParse(call.name);
      let elementId: string | undefined;
      try {
        const args = JSON.parse(call.arguments);
        if (typeof args?.element_id === "string") elementId = args.element_id;
      } catch {
        // The executor returns the actual argument error as tool feedback.
      }
      const activity = {
        id: toolId(index),
        kind: kind.success ? kind.data : ("tool" as const),
        retry: call.name === "apply_patch" && session.patchFailed,
        selected: call.name === "read_source" && !!elementId,
      };
      emit({
        ...activity,
        status: "running",
        detail: "Executing against the current virtual drawing.html.",
      });
      const output = await session.execute(call, signal, (status) =>
        emit({
          id: `${activity.id}:validation`,
          kind: "validation",
          status,
          detail:
            "Sandbox execution, millimeter scale and SVG structure checks.",
        }),
      );
      const feedback = JSON.parse(output);
      emit({
        ...activity,
        status: feedback.ok ? "completed" : "failed",
        detail: feedback.ok
          ? feedback.message ||
            (typeof feedback.matches === "number"
              ? `Found ${feedback.matches} matches in drawing.html.`
              : activity.selected
                ? "Read selected-element source and associated dimensions in drawing.html."
                : "Read numbered source lines from drawing.html.")
          : feedback.error,
      });
      results.push(output);
    }
    const turn: AgentTurn = {
      questionRound: context.toolTurns.length,
      content: toolResult.content,
      calls: toolResult.calls,
      results,
    };
    context = {
      ...context,
      source: session.source,
      agentTurns: [...context.agentTurns, turn],
    };
    if (JSON.stringify(context.agentTurns).length > 3_000_000)
      throw new Error(
        "The tool conversation is too large. Your drawing is unchanged.",
      );
    round++;
  }
}

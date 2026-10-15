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

type AgentOptions = {
  context: DrawingContext;
  config: ModelConfig;
  drawing: Drawing | null;
  signal: AbortSignal;
  request: (
    input: DrawingRequest,
    signal: AbortSignal,
    delta: (text: string) => void,
  ) => Promise<DrawingResult>;
  validate: SourceValidator;
  isCurrent: () => boolean;
  onDelta: (text: string) => void;
  onRound: () => void;
  onTool?: (name: string) => void;
};
export async function runDrawingAgent(options: AgentOptions): Promise<{
  result: DrawingResult;
  context: DrawingContext;
  drawing?: Drawing;
}> {
  const { signal, drawing } = options;
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
    const html = await formatDrawingSource(svgToHTML(drawing.svg));
    session = new DrawingToolSession(
      { ...context.source, html },
      drawing,
      context.selectedId,
      options.validate,
      options.isCurrent,
    );
  }
  const ids = new Set([
    ...context.agentTurns.flatMap((turn) => turn.calls.map((c) => c.id)),
    ...context.toolTurns.flatMap((turn) => turn.calls.map((c) => c.id)),
  ]);
  while (true) {
    signal.throwIfAborted();
    if (!options.isCurrent())
      throw new Error(
        "Revision conflict: the committed drawing changed. Start a new request.",
      );
    if (session) context = { ...context, source: session.source };
    options.onRound();
    const result = await options.request(
      { ...context, config: options.config },
      signal,
      options.onDelta,
    );
    signal.throwIfAborted();
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
    for (const call of toolResult.calls) {
      if (ids.has(call.id))
        throw new Error(
          "The model reused a tool call ID. Your drawing is unchanged.",
        );
      ids.add(call.id);
      options.onTool?.(call.name);
      results.push(await session.execute(call, signal));
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
  }
}

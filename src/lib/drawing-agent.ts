// Adapted control flow: Codex records calls/results, then samples again until
// no follow-up tool work remains. See third_party/codex/apply-patch/README.md.
import type { DrawingContext } from "./ai-workflow";
import { drawingRevision } from "./ai-workflow";
import {
  agentCallsResultSchema,
  finishDrawingSchema,
  type AgentTurn,
} from "./agent-contracts";
import type {
  Drawing,
  DrawingRequest,
  DrawingResult,
  ModelConfig,
  ChatAttachment,
} from "./contracts";
import {
  DrawingToolSession,
  type SourceValidator,
  type DrawingToolSnapshot,
} from "./drawing-tool-session";
import { formatDrawingSource } from "./format-source";
import { svgToHTML } from "./drawing";
import { ResourceToolSession } from "./resource-tool-session";
import { placeSvgSchema } from "./resource-contracts";
import { ModelFailure } from "./model-failure";
import {
  toolPendingSchema,
  type ActivityHandler,
  type ToolPending,
} from "./agent-activity";

type AgentOptions = {
  projectId: string;
  recovery?: DrawingAgentCheckpoint;
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
  resources?: ChatAttachment[];
};
export type DrawingAgentCheckpoint = {
  projectId: string;
  baseRevision?: string;
  context: DrawingContext;
  resources: ChatAttachment[];
  session?: DrawingToolSnapshot;
  round: number;
  attempt: number;
};
export class DrawingAgentRecoveryError extends Error {
  constructor(
    public checkpoint: DrawingAgentCheckpoint,
    failure: Error,
  ) {
    super(failure.message);
  }
}
export async function runDrawingAgent(options: AgentOptions): Promise<{
  result: DrawingResult;
  context: DrawingContext;
  drawing?: Drawing;
}> {
  const { signal, drawing } = options;
  const recovery = options.recovery;
  const projectId = options.projectId;
  const baseRevision = drawing ? drawingRevision(drawing) : undefined;
  signal.throwIfAborted();
  if (
    recovery &&
    (recovery.projectId !== projectId ||
      recovery.baseRevision !== baseRevision ||
      !options.isCurrent())
  )
    throw new Error(
      "Revision conflict: the committed drawing changed. Start a new request.",
    );
  const emit: ActivityHandler = (activity) => {
    let detail = activity.detail;
    if (detail) {
      for (const secret of [options.config.apiKey, options.config.baseURL])
        if (secret) detail = detail.split(secret).join("[redacted]");
    }
    options.onActivity?.({ ...activity, detail: detail?.slice(0, 2000) });
  };
  const permittedResources = recovery?.resources || [
    ...(options.resources || options.context.attachments || []),
    ...(options.context.image
      ? [
          {
            id: "reference-sketch",
            name: "Reference sketch",
            type: "image" as const,
            size: Math.floor(options.context.image.length * 0.75),
            image: options.context.image,
          },
        ]
      : []),
  ];
  const resources = new ResourceToolSession(permittedResources);
  let context = {
    ...(recovery?.context || options.context),
    attachments: undefined,
    image: undefined,
    resources: resources.metadata.slice(0, 100),
    agentTurns:
      recovery?.context.agentTurns || options.context.agentTurns || [],
    toolTurns: recovery?.context.toolTurns || options.context.toolTurns || [],
  };
  let session: DrawingToolSession | undefined;
  if (recovery?.session) {
    session = new DrawingToolSession(
      recovery.session.source,
      recovery.session.drawing,
      options.validate,
      options.isCurrent,
      (id) => resources.get(id),
      recovery.session,
    );
  } else if (context.source && drawing) {
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
      (id) => resources.get(id),
    );
  }
  const ids = new Set([
    ...context.agentTurns.flatMap((turn) => turn.calls.map((c) => c.id)),
    ...context.toolTurns.flatMap((turn) => turn.calls.map((c) => c.id)),
  ]);
  let round = recovery?.round || 0;
  let attempt = recovery?.attempt || 0;
  let failures = 0;
  while (true) {
    signal.throwIfAborted();
    if (!options.isCurrent())
      throw new Error(
        "Revision conflict: the committed drawing changed. Start a new request.",
      );
    if (session)
      context = {
        ...context,
        mode: "edit",
        svg: session.drawing.svg,
        source: session.source,
      };
    options.onRound();
    const modelId = `model:${round}${attempt ? `:attempt:${attempt}` : ""}`;
    const toolId = (index: number) =>
      `tool:${round}:${index}${attempt ? `:attempt:${attempt}` : ""}`;
    const pendingTools = new Map<number, ToolPending["name"]>();
    emit({ id: modelId, kind: "model", status: "running", retry: attempt > 0 });
    let result: DrawingResult;
    try {
      result = await options.request(
        { ...context, config: options.config },
        signal,
        options.onDelta,
        ({ index, name }) => {
          pendingTools.set(index, name);
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
      if (
        result.kind === "tool_calls" &&
        result.calls.some((c) => c.name === "finish_drawing")
      ) {
        const call = result.calls[0];
        let completion;
        try {
          completion = finishDrawingSchema.parse(JSON.parse(call.arguments));
        } catch {
          // Never reflect arguments or parser errors in diagnostics.
        }
        if (
          result.calls.length !== 1 ||
          call.name !== "finish_drawing" ||
          ids.has(call.id) ||
          !completion ||
          !session?.changed ||
          session.patchFailed ||
          completion.revision !== session.source.revision
        )
          throw new ModelFailure(
            "The model returned an invalid drawing completion.",
            {
              code: "invalid_response",
              retryable: true,
              diagnostic: {
                category: "invalid_completion",
                length: Math.min(call.arguments.length, 1_200_000),
              },
            },
          );
        emit({ id: toolId(0), kind: "finish_drawing", status: "completed" });
        result = { kind: "message", message: completion.summary };
      }
    } catch (error) {
      signal.throwIfAborted();
      if (!options.isCurrent())
        throw new Error(
          "Revision conflict: the committed drawing changed. Start a new request.",
        );
      if (
        !(error instanceof ModelFailure) ||
        !error.info?.retryable ||
        !context.agentTurns.length
      )
        throw error;
      for (const [index, name] of pendingTools)
        emit({
          id: toolId(index),
          kind: name,
          status: "failed",
          detail: "Model response incomplete; this tool was not executed.",
        });
      emit({
        id: modelId,
        kind: "model",
        status: "failed",
        detail: `Model round ${round}, attempt ${attempt}: ${JSON.stringify(error.info)}. Successful steps remain staged; no changes have been applied.`,
      });
      context = { ...context, recovering: true };
      attempt++;
      if (++failures > 2)
        throw new DrawingAgentRecoveryError(
          {
            projectId,
            baseRevision,
            context,
            resources: permittedResources,
            session: session?.snapshot(),
            round,
            attempt,
          },
          error,
        );
      continue;
    }
    signal.throwIfAborted();
    failures = 0;
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
    const previews: NonNullable<AgentTurn["previews"]> = [];
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
        retry: call.name === "apply_patch" && !!session?.patchFailed,
        selected: call.name === "read_source" && !!elementId,
      };
      emit({
        ...activity,
        status: "running",
        detail: [
          "list_resources",
          "inspect_resource",
          "read_resource",
        ].includes(call.name)
          ? "Accessing permitted resources in the originating project."
          : "Executing against the current virtual drawing.html.",
      });
      if (!session && call.name === "place_svg") {
        try {
          const input = placeSvgSchema.parse(JSON.parse(call.arguments));
          if (input.canvas) {
            const { width, height } = input.canvas;
            const svg = `<svg xmlns="http://www.w3.org/2000/svg" id="drawing" width="${width}mm" height="${height}mm" viewBox="0 0 ${width} ${height}"><g id="geometry" data-layer="geometry"/><g id="dimensions" data-layer="dimensions"/></svg>`;
            session = new DrawingToolSession(
              {
                path: "drawing.html",
                revision: "empty-canvas",
                html: svgToHTML(svg),
              },
              {
                title: "Drawing",
                summary: "",
                notes: context.notes,
                svg,
                html: svgToHTML(svg),
              },
              options.validate,
              options.isCurrent,
              (id) => resources.get(id),
            );
          }
        } catch {
          /* Invalid arguments become bounded tool feedback below. */
        }
      }
      const resourceCall = [
        "list_resources",
        "inspect_resource",
        "read_resource",
      ].includes(call.name);
      const access = resourceCall
        ? await resources.execute(call, signal)
        : undefined;
      if (access?.preview) previews.push(access.preview);
      const output =
        access?.output ||
        (session
          ? await session.execute(call, signal, (status) =>
              emit({
                id: `${activity.id}:validation`,
                kind: "validation",
                status,
                detail:
                  "Sandbox execution, millimeter scale and SVG structure checks.",
              }),
            )
          : JSON.stringify({
              ok: false,
              error:
                "Create a drawing first, or use place_svg with explicit canvas width and height in millimeters. Ask the user for missing measurements.",
            }));
      const feedback = JSON.parse(output);
      emit({
        ...activity,
        status: feedback.ok ? "completed" : "failed",
        detail: feedback.ok
          ? feedback.message ||
            (resourceCall ? "Project resource access completed." : undefined) ||
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
      source: session?.source,
      agentTurns: [
        ...context.agentTurns,
        { ...turn, ...(previews.length ? { previews } : {}) },
      ],
    };
    if (JSON.stringify(context.agentTurns).length > 6_000_000)
      throw new Error(
        "The tool conversation is too large. Your drawing is unchanged.",
      );
    round++;
    attempt = 0;
  }
}

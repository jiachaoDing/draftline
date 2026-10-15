import type {
  ChatMessage,
  Drawing,
  DrawingRequest,
  AIResult,
} from "./contracts";
import { applyPatches, svgToHTML } from "./drawing";

// Credentials enter only at the transport boundary, never into saved context.
export type DrawingContext = Omit<DrawingRequest, "config">;

export function drawingRevision(drawing: Drawing) {
  if (drawing.revision) return drawing.revision;
  // Stable identity for bundled examples and records created before first save.
  let hash = 2166136261;
  for (const c of drawing.svg)
    hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
  return `source-${(hash >>> 0).toString(16)}`;
}

export function conversationHistory(messages: ChatMessage[]) {
  return messages
    .filter((message) => !message.status || message.status === "complete")
    .slice(-10)
    .map((message) => ({
      role: message.role,
      text: message.text.slice(0, 8000),
    }));
}

export function drawingContext(
  instruction: string,
  messages: ChatMessage[],
  drawing: Drawing | null,
  image?: string,
  selectedId?: string,
  clarification?: DrawingContext | null,
): DrawingContext {
  const history = conversationHistory(messages);
  if (clarification)
    return {
      ...clarification,
      instruction: `${clarification.instruction}\nUser clarification: ${instruction}`,
      history,
    };
  return {
    mode: drawing ? "edit" : "generate",
    instruction,
    image,
    svg: drawing?.svg,
    selectedId,
    notes: drawing?.notes || [],
    toolTurns: [],
    agentTurns: [],
    source: drawing
      ? {
          path: "drawing.html",
          revision: drawingRevision(drawing),
          html: drawing.html,
        }
      : undefined,
    history,
  };
}

/** A full source remains a candidate until the sandbox returns a valid snapshot. */
export function drawingChange(
  result: Extract<AIResult, { kind: "drawing" | "patch" }>,
  input: DrawingContext,
  drawing: Drawing | null,
):
  | { kind: "commit"; drawing: Drawing }
  | { kind: "validate"; candidate: Omit<Drawing, "svg"> } {
  if (result.kind === "patch") {
    if (!input.selectedId || !input.svg || !drawing)
      throw new Error(
        "The model returned a targeted edit without a selected element. Try again.",
      );
    const svg = applyPatches(input.svg, result.patches, input.selectedId);
    return {
      kind: "commit",
      drawing: {
        title: drawing.title,
        svg,
        html: svgToHTML(svg),
        summary: result.summary,
        notes: drawing.notes,
      },
    };
  }
  if (input.mode === "edit" && input.selectedId)
    throw new Error(
      "The model tried to replace the whole drawing during a selected edit. Clear selection for a whole-drawing edit.",
    );
  return {
    kind: "validate",
    candidate: {
      title: result.title,
      html: result.html,
      summary: result.summary,
      notes: result.notes,
    },
  };
}

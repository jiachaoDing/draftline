import {
  applyPatchSchema,
  readSourceSchema,
  searchSourceSchema,
  type AgentCall,
  type VirtualSource,
} from "./agent-contracts";
import type { Drawing } from "./contracts";
import { applyCodexPatch } from "./codex-patch";
import { cleanDrawing, svgToHTML } from "./drawing";
import { formatDrawingSource } from "./format-source";
import { readSource, searchSource, sourceInfo } from "./source-inspection";
import { ZodError } from "zod";

function argumentError(error: ZodError, name: string) {
  const schema =
    name === "read_source"
      ? readSourceSchema
      : name === "search_source"
        ? searchSourceSchema
        : applyPatchSchema;
  const fields = Object.keys(schema.shape);
  const details = error.issues
    .slice(0, 4)
    .map((issue) => {
      if (issue.code === "unrecognized_keys")
        return `Use only these fields: ${fields.join(", ")}.`;
      const field =
        typeof issue.path[0] === "string" && fields.includes(issue.path[0])
          ? issue.path[0]
          : "arguments";
      return `${field}: ${issue.message}`;
    })
    .join("; ");
  const example =
    name === "read_source"
      ? ' Use {"file_path":"drawing.html","offset":1,"limit":80}; omit element_id or use null for a whole-file read.'
      : " Correct these fields and retry.";
  return `Invalid tool arguments for ${name}. ${details}.${example}`;
}

export type SourceValidator = (
  html: string,
  signal: AbortSignal,
) => Promise<string>;
export class DrawingToolSession {
  private inspectedRevision?: string;
  changed = false;
  patchFailed = false;
  constructor(
    public source: VirtualSource,
    public drawing: Drawing,
    private validate: SourceValidator,
    private isCurrent: () => boolean,
  ) {}
  async execute(
    call: AgentCall,
    signal: AbortSignal,
    onValidation?: (
      status: "running" | "completed" | "failed" | "cancelled",
    ) => void,
  ): Promise<string> {
    signal.throwIfAborted();
    if (!this.isCurrent())
      throw new Error(
        "Revision conflict: the committed drawing changed. Start a new request.",
      );
    let validating = false;
    try {
      const args: unknown = JSON.parse(call.arguments);
      if (call.name === "read_source") {
        const input = readSourceSchema.parse(args);
        const result = readSource(
          this.source,
          input.offset,
          input.limit,
          input.element_id,
        );
        this.inspectedRevision = this.source.revision;
        return JSON.stringify({ ok: true, ...result });
      }
      if (call.name === "search_source") {
        const input = searchSourceSchema.parse(args);
        const result = searchSource(this.source, input.query);
        this.inspectedRevision = this.source.revision;
        return JSON.stringify({ ok: true, ...result });
      }
      if (call.name !== "apply_patch")
        throw new Error(
          "Unsupported tool. Available tools: read_source, search_source, apply_patch. Ask questions in a separate tool round before editing.",
        );
      const input = applyPatchSchema.parse(args);
      if (input.revision !== this.source.revision)
        throw new Error(
          "Revision conflict: read drawing.html again and use the current revision.",
        );
      if (this.inspectedRevision !== this.source.revision)
        throw new Error(
          "Read or search the current source revision before applying a patch.",
        );
      const html = await applyCodexPatch(this.source.html, input.patch);
      if (html.length > 600_000)
        throw new Error("The patched source is too large.");
      validating = true;
      onValidation?.("running");
      const svg = cleanDrawing(await this.validate(html, signal));
      signal.throwIfAborted();
      const canonical = await formatDrawingSource(svgToHTML(svg));
      signal.throwIfAborted();
      if (!this.isCurrent())
        throw new Error(
          "Revision conflict: the committed drawing changed. Start a new request.",
        );
      // All asynchronous execution and policy checks finish before replacing state.
      const revision = crypto.randomUUID();
      this.drawing = { ...this.drawing, svg, html: svgToHTML(svg), revision };
      this.source = { path: "drawing.html", revision, html: canonical };
      this.changed = true;
      this.patchFailed = false;
      onValidation?.("completed");
      return JSON.stringify({
        ok: true,
        ...sourceInfo(this.source),
        message:
          "Success. Updated drawing.html; sandbox validation passed. Inspect the canonical source before another patch.",
      });
    } catch (error) {
      if (validating) onValidation?.(signal.aborted ? "cancelled" : "failed");
      if (signal.aborted || (error as Error).name === "AbortError") throw error;
      if (call.name === "apply_patch") this.patchFailed = true;
      const message =
        error instanceof ZodError
          ? argumentError(error, call.name)
          : error instanceof SyntaxError
            ? "Invalid tool arguments: provide a complete JSON object matching the tool schema."
            : (error as Error).message;
      return JSON.stringify({
        ok: false,
        ...sourceInfo(this.source),
        error: message.slice(0, 8000),
      });
    }
  }
}

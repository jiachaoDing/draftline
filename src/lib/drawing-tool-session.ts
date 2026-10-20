import {
  applyPatchSchema,
  readSourceSchema,
  searchSourceSchema,
  type AgentCall,
  type VirtualSource,
} from "./agent-contracts";
import type { Drawing, ChatAttachment } from "./contracts";
import { applyCodexPatch } from "./codex-patch";
import { cleanDrawing, sanitizeSVG, serialize, svgToHTML } from "./drawing";
import { placeSvgSchema, transformObjectSchema } from "./resource-contracts";
import { resourceText } from "./resources";
import { reusableSvg } from "./svg-resource";
import { placeMeasuredSvg } from "./svg-placement";
import { formatDrawingSource } from "./format-source";
import { readSource, searchSource, sourceInfo } from "./source-inspection";
import { ZodError } from "zod";

// Runs synchronously inside the existing validation sandbox. Native SVG matrices
// account for ancestor transforms and nested viewports without parsing geometry.
function adjustCanvasTransform(
  id: string,
  placement: boolean,
  x: number,
  y: number,
  scale: number,
  rotation: number,
) {
  const root = document.querySelector<SVGSVGElement>("svg#drawing")!;
  const node = document.getElementById(id) as unknown as SVGGraphicsElement;
  const ancestors: SVGGraphicsElement[] = [];
  for (
    let parent = node.parentElement;
    parent && parent !== (root as unknown as Element);
    parent = parent.parentElement
  )
    ancestors.unshift(parent as unknown as SVGGraphicsElement);
  let p = root.createSVGMatrix();
  for (const parent of ancestors) {
    const transforms = parent.transform?.baseVal;
    if (transforms)
      for (let index = 0; index < transforms.numberOfItems; index++)
        p = p.multiply(transforms.getItem(index).matrix);
    if (parent instanceof SVGSVGElement) {
      p = p.translate(parent.x.baseVal.value, parent.y.baseVal.value);
      const box = parent.viewBox.baseVal;
      if (box.width > 0 && box.height > 0) {
        const width = parent.width.baseVal.value,
          height = parent.height.baseVal.value;
        let sx = width / box.width,
          sy = height / box.height;
        const aspect = parent.preserveAspectRatio.baseVal;
        let tx = 0,
          ty = 0;
        if (aspect.align !== 1) {
          sx = sy =
            aspect.meetOrSlice === 2 ? Math.max(sx, sy) : Math.min(sx, sy);
          tx = ((width - box.width * sx) * ((aspect.align - 2) % 3)) / 2;
          ty =
            ((height - box.height * sy) * Math.floor((aspect.align - 2) / 3)) /
            2;
        }
        p = p
          .translate(tx, ty)
          .scaleNonUniform(sx, sy)
          .translate(-box.x, -box.y);
      }
    }
  }
  if (Math.abs(p.a * p.d - p.b * p.c) < 1e-12)
    throw new Error("The object's parent transform is singular.");
  const local =
    node.transform.baseVal.consolidate()?.matrix || root.createSVGMatrix();
  const delta = root
    .createSVGMatrix()
    .translate(x, y)
    .rotate(rotation)
    .scale(scale);
  const matrix = placement
    ? p.inverse().multiply(local)
    : p
        .inverse()
        .multiply(delta)
        .multiply(p)
        .multiply(delta.inverse())
        .multiply(local);
  if (
    ![matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f].every(
      Number.isFinite,
    )
  )
    throw new Error("The object transform is invalid.");
  node.setAttribute(
    "transform",
    `matrix(${matrix.a} ${matrix.b} ${matrix.c} ${matrix.d} ${matrix.e} ${matrix.f})`,
  );
}

function argumentError(error: ZodError, name: string) {
  const schema =
    name === "read_source"
      ? readSourceSchema
      : name === "search_source"
        ? searchSourceSchema
        : name === "place_svg"
          ? placeSvgSchema
          : name === "transform_object"
            ? transformObjectSchema
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
export type DrawingToolSnapshot = {
  source: VirtualSource;
  drawing: Drawing;
  changed: boolean;
  patchFailed: boolean;
  inspectedRevision?: string;
};
export class DrawingToolSession {
  private inspectedRevision?: string;
  changed = false;
  patchFailed = false;
  constructor(
    public source: VirtualSource,
    public drawing: Drawing,
    private validate: SourceValidator,
    private isCurrent: () => boolean,
    private resource?: (id: string) => ChatAttachment,
    restored?: DrawingToolSnapshot,
  ) {
    if (restored) {
      this.changed = restored.changed;
      this.patchFailed = restored.patchFailed;
      this.inspectedRevision = restored.inspectedRevision;
    }
  }
  snapshot(): DrawingToolSnapshot {
    return {
      source: this.source,
      drawing: this.drawing,
      changed: this.changed,
      patchFailed: this.patchFailed,
      inspectedRevision: this.inspectedRevision,
    };
  }
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
      let html: string;
      if (call.name === "place_svg" || call.name === "transform_object") {
        let script: string;
        const svg = sanitizeSVG(this.drawing.svg);
        if (call.name === "place_svg") {
          const input = placeSvgSchema.parse(args);
          if (input.revision && input.revision !== this.source.revision)
            throw new Error(
              "Revision conflict: inspect the current drawing revision and retry.",
            );
          if (!input.revision && this.source.revision !== "empty-canvas")
            throw new Error(
              "Use the current drawing revision when placing an SVG.",
            );
          const item = this.resource?.(input.resource_id);
          if (!item || item.type !== "svg")
            throw new Error("Choose an SVG resource from this project.");
          if (
            [...svg.querySelectorAll("[id]")].some(
              (node) => node.id === input.object_id,
            )
          )
            throw new Error(
              "The object ID is already used. Choose a unique ID.",
            );
          const asset = reusableSvg(resourceText(item), input.object_id);
          const targetId = input.target_id
            ? asset.ids.get(input.target_id)
            : undefined;
          if (input.target_id && !targetId)
            throw new Error(
              "target_id must be an original resource element ID. Read the resource to select the artwork group.",
            );
          const group = svg.ownerDocument.createElementNS(
            "http://www.w3.org/2000/svg",
            "g",
          );
          group.id = input.object_id;
          group.setAttribute("data-label", item.name);
          group.setAttribute("data-resource-id", item.id);
          group.setAttribute(
            "transform",
            `translate(${input.x} ${input.y}) rotate(${input.rotation || 0}) scale(${input.width / asset.width})`,
          );
          group.append(svg.ownerDocument.importNode(asset.svg, true));
          svg.querySelector("#geometry")!.append(group);
          const placement = {
            ...input,
            target_id: targetId,
            assetWidth: asset.width,
            assetHeight: asset.height,
          };
          script = `document.addEventListener('DOMContentLoaded', () => { (${placeMeasuredSvg.toString()})(${JSON.stringify(placement).replaceAll("<", "\\u003c")}); }, { once: true });`;
        } else {
          const input = transformObjectSchema.parse(args);
          if (input.revision !== this.source.revision)
            throw new Error(
              "Revision conflict: inspect the current drawing revision and retry.",
            );
          const node = [...svg.querySelectorAll("#geometry [id]")].find(
            (node) => node.id === input.object_id,
          );
          if (
            !node ||
            !node.matches(
              "g,path,circle,rect,ellipse,line,polygon,polyline,text,use",
            ) ||
            node.closest("defs,clipPath,mask")
          )
            throw new Error("Transform an existing geometry object or group.");
          node.setAttribute(
            "transform",
            `translate(${input.x} ${input.y}) rotate(${input.rotation}) scale(${input.scale}) ${node.getAttribute("transform") || ""}`.trim(),
          );
          const adjustment = [
            input.object_id,
            false,
            input.x,
            input.y,
            input.scale,
            input.rotation,
          ];
          script = `(${adjustCanvasTransform.toString()})(...${JSON.stringify(adjustment).replaceAll("<", "\\u003c")});`;
        }
        html = `${svgToHTML(serialize(svg))}<script>${script}</script>`;
      } else {
        if (call.name !== "apply_patch")
          throw new Error(
            "Unsupported tool. Available drawing tools: read_source, search_source, apply_patch, place_svg, transform_object. Ask questions in a separate tool round before editing.",
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
        html = await applyCodexPatch(this.source.html, input.patch);
      }
      if (html.length > 600_000)
        throw new Error("The patched source is too large.");
      validating = true;
      onValidation?.("running");
      const svg = cleanDrawing(await this.validate(html, signal));
      signal.throwIfAborted();
      const canonical = await formatDrawingSource(svgToHTML(svg));
      if (canonical.length > 600_000 || svg.length > 600_000)
        throw new Error(
          "This resource exceeds the drawing's 600,000-character capacity. Use a smaller SVG resource.",
        );
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
      if (["apply_patch", "place_svg", "transform_object"].includes(call.name))
        this.patchFailed = true;
      const message =
        error instanceof ZodError &&
        [
          "apply_patch",
          "read_source",
          "search_source",
          "place_svg",
          "transform_object",
        ].includes(call.name)
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

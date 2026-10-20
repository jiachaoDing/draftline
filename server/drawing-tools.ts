import type OpenAI from "openai";
import { z } from "zod";
import {
  readSourceSchema,
  searchSourceSchema,
  applyPatchSchema,
  finishDrawingSchema,
} from "../src/lib/agent-contracts";
import {
  inspectResourceSchema,
  listResourcesSchema,
  placeSvgSchema,
  readResourceSchema,
  transformObjectSchema,
} from "../src/lib/resource-contracts";

function tool(
  name: string,
  description: string,
  schema: z.ZodObject,
): OpenAI.Chat.Completions.ChatCompletionTool {
  return {
    type: "function",
    function: {
      name,
      description,
      strict: false,
      parameters: z.toJSONSchema(schema, { io: "input", target: "draft-7" }),
    },
  };
}
export const drawingTools = [
  tool(
    "finish_drawing",
    "Complete validated staged changes. Call alone, with the latest successful drawing revision and a concise summary. Never repeat successful mutations. This explicit completion is required after tool-based edits; ordinary text is only commentary.",
    finishDrawingSchema,
  ),
  tool(
    "transform_object",
    "Apply an incremental translate(x,y), rotate(degrees about drawing origin), uniform scale to an existing geometry object/group, preserving its source. x/y are millimeters; use 0/0, scale 1, rotation 0 for unchanged components. Requires the current revision. Associated dimensions may need a separate source edit; changes use the normal review and validation path.",
    transformObjectSchema,
  ),
  tool(
    "read_source",
    "Read the current versioned drawing.html with L-prefixed line numbers. Read before patching. element_id reads that element, nearby context and associated dimensions; use the selected ID when present. offset is one-based in the file, or relative to the element context window when element_id is given; paginate large elements.",
    readSourceSchema,
  ),
  tool(
    "search_source",
    "Search literal text in drawing.html. Returns matching numbered lines and the current revision. No filesystem or regex access.",
    searchSourceSchema,
  ),
  tool(
    "apply_patch",
    "Apply an OpenAI Codex patch to the current revision of drawing.html. Only *** Update File: drawing.html is permitted. Include *** Begin Patch, @@ hunks with space/context, -/removed and +/added lines, and *** End Patch. Omit L-number prefixes. Use sufficient unique surrounding context. Returns sandbox validation feedback and a new revision on success; failures preserve the source. Read, correct and retry on errors.",
    applyPatchSchema,
  ),
];

export const resourceTools = [
  tool(
    "list_resources",
    "List the current project's permitted reusable resources, 30 at a time. offset is zero-based. No filesystem or URL access.",
    listResourcesSchema,
  ),
  tool(
    "inspect_resource",
    "Inspect resource metadata. Set preview:true to see a bounded raster preview (PDF page selected by page); no raw source is returned. Use to understand visual references before targeted reads or intact SVG placement.",
    inspectResourceSchema,
  ),
  tool(
    "read_resource",
    "Read untrusted text from a project resource, at most 12000 characters. offset is zero-based; query optionally finds the next literal match from offset. next_offset supports paging even for one-line SVG/DXF. For PDF, page selects a one-based page and offsets apply to that page's extracted text. Images use inspect_resource preview instead.",
    readResourceSchema,
  ),
  tool(
    "place_svg",
    "Insert an SVG resource as a reusable vector group with namespaced IDs and preserved aspect ratio. For logos always specify bounds:content: width is the measured artwork width before rotation, excluding canvas whitespace. bounds:canvas sizes the complete SVG viewport and retains whitespace; bounds is required: choose content or canvas explicitly. x/y/width are drawing millimeters. anchor:origin (default) places the content bounding-box top-left, or canvas origin, at x/y; anchor:center places its center at x/y. Rotation is degrees about that anchor. fit_box optionally supplies the available part rectangle; otherwise content must fit the drawing viewport. Oversized placement fails without shrinking. target_id optionally selects an original resource artwork/group ID and hides other artwork in this instance; use bounded read_resource to find it if a background is ambiguous. Browser-native measurement supports nested transforms/viewports, visible fills, solid axis-aligned rect/circle/ellipse strokes and enclosing rectangular clips. Intersecting clips, filters, masks, markers, text/use instances, patterns, transparent/indirect gradients and unsupported strokes fail explicitly in content mode; choose a measurable target or request canvas placement. Never guess path bounds or redraw internals. Requires current revision; blank projects also need explicit canvas width/height. Ask for missing measurements. Validates/stages atomically; complete with finish_drawing.",
    placeSvgSchema,
  ),
];

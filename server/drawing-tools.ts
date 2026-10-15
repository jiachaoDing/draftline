import type OpenAI from "openai";
import { z } from "zod";
import {
  readSourceSchema,
  searchSourceSchema,
  applyPatchSchema,
} from "../src/lib/agent-contracts";

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

import type OpenAI from "openai";

function tool(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[],
): OpenAI.Chat.Completions.ChatCompletionTool {
  return {
    type: "function",
    function: {
      name,
      description,
      strict: false,
      parameters: {
        type: "object",
        additionalProperties: false,
        properties,
        required,
      },
    },
  };
}
const file = { file_path: { type: "string", enum: ["drawing.html"] } };
export const drawingTools = [
  tool(
    "read_source",
    "Read the current versioned drawing.html with L-prefixed line numbers. Read before patching. element_id reads that element, nearby context and associated dimensions; use the selected ID when present. offset is one-based in the file, or relative to the element context window when element_id is given; paginate large elements.",
    {
      ...file,
      offset: { type: "integer", minimum: 1 },
      limit: { type: "integer", minimum: 1, maximum: 200 },
      element_id: { type: "string" },
    },
    ["file_path"],
  ),
  tool(
    "search_source",
    "Search literal text in drawing.html. Returns matching numbered lines and the current revision. No filesystem or regex access.",
    { ...file, query: { type: "string" } },
    ["file_path", "query"],
  ),
  tool(
    "apply_patch",
    "Apply an OpenAI Codex patch to the current revision of drawing.html. Only *** Update File: drawing.html is permitted. Include *** Begin Patch, @@ hunks with space/context, -/removed and +/added lines, and *** End Patch. Omit L-number prefixes. Use sufficient unique surrounding context. Returns sandbox validation feedback and a new revision on success; failures preserve the source. Read, correct and retry on errors.",
    {
      revision: { type: "string" },
      patch: { type: "string" },
    },
    ["revision", "patch"],
  ),
];

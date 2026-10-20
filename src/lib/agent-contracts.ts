import { z } from "zod";
import { resourcePreviewSchema } from "./resource-contracts";

export const sourceSchema = z.object({
  path: z.literal("drawing.html"),
  revision: z.string().min(1).max(200),
  html: z.string().max(600_000),
});
export const agentCallSchema = z.object({
  id: z.string().min(1).max(200),
  name: z.string().min(1).max(100),
  arguments: z.string().max(200_000),
});
export const agentCallsResultSchema = z
  .object({
    kind: z.literal("tool_calls"),
    content: z.string().max(16000),
    calls: z.array(agentCallSchema).min(1).max(4),
  })
  .refine(({ calls }) => new Set(calls.map((c) => c.id)).size === calls.length);
export const agentTurnSchema = z
  .object({
    questionRound: z.number().int().min(0).max(12),
    content: z.string().max(16000),
    calls: z.array(agentCallSchema).min(1).max(4),
    results: z.array(z.string().max(64_000)).min(1).max(4),
    previews: z.array(resourcePreviewSchema).max(4).optional(),
  })
  .refine((turn) => turn.calls.length === turn.results.length);
export type VirtualSource = z.infer<typeof sourceSchema>;
export type AgentCall = z.infer<typeof agentCallSchema>;
export type AgentTurn = z.infer<typeof agentTurnSchema>;
export const finishDrawingSchema = z
  .object({
    revision: z.string().min(1).max(200),
    summary: z.string().trim().min(1).max(3000),
  })
  .strict();

const file = { file_path: z.enum(["drawing.html"]) };
export const readSourceSchema = z
  .object({
    ...file,
    offset: z
      .number()
      .int()
      .min(1)
      .nullable()
      .default(1)
      .describe("One-based line offset. Omit or use null for 1.")
      .transform((value) => value ?? 1),
    limit: z
      .number()
      .int()
      .min(1)
      .max(200)
      .nullable()
      .default(80)
      .describe(
        "Number of lines, 1 to 200. Omit or use null for 80; paginate for more.",
      )
      .transform((value) => value ?? 80),
    element_id: z
      .string()
      .max(200)
      .nullish()
      .describe(
        "Exact element ID for focused inspection. Omit or use null to read the file.",
      )
      .transform((value) => value || undefined),
  })
  .strict();
export const searchSourceSchema = z
  .object({
    ...file,
    query: z.string().min(1).max(500),
  })
  .strict();
export const applyPatchSchema = z
  .object({
    revision: z.string().min(1).max(200),
    patch: z.string().min(1).max(200_000),
  })
  .strict();

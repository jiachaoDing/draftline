import { z } from "zod";

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
  })
  .refine((turn) => turn.calls.length === turn.results.length);
export type VirtualSource = z.infer<typeof sourceSchema>;
export type AgentCall = z.infer<typeof agentCallSchema>;
export type AgentTurn = z.infer<typeof agentTurnSchema>;

const file = { file_path: z.literal("drawing.html") };
export const readSourceSchema = z
  .object({
    ...file,
    offset: z.number().int().min(1).default(1),
    limit: z.number().int().min(1).max(200).default(80),
    element_id: z.string().max(200).optional(),
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

import { z } from "zod";

// Metadata only: never include response excerpts, parser messages or tool arguments.
export const responseDiagnosticSchema = z.object({
  category: z.enum([
    "plain_text",
    "invalid_escape",
    "truncated_json",
    "malformed_json",
    "invalid_shape",
    "token_limit",
    "incomplete_stream",
    "invalid_completion",
  ]),
  length: z.number().int().min(0).max(1_200_000),
  finish: z.enum(["stop", "length", "missing"]).optional(),
  position: z.number().int().min(0).max(1_200_000).optional(),
});
export const modelFailureSchema = z.object({
  code: z.enum(["invalid_json", "invalid_response", "connection", "truncated"]),
  retryable: z.boolean(),
  diagnostic: responseDiagnosticSchema.optional(),
});
export type ModelFailureInfo = z.infer<typeof modelFailureSchema>;

export class ModelFailure extends Error {
  constructor(
    message: string,
    public info?: ModelFailureInfo,
  ) {
    super(message);
  }
}

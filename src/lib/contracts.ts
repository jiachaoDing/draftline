import { z } from "zod";
import type { AgentActivity } from "./agent-activity";
import {
  agentCallsResultSchema,
  agentTurnSchema,
  sourceSchema,
} from "./agent-contracts";
import {
  userInputCallSchema,
  userInputTurnSchema,
  userInputResponseSchema,
  questionnaireSchema,
  userInputArgsSchema,
} from "./user-input";

export const configSchema = z.object({
  baseURL: z.string().min(1).max(2048),
  apiKey: z.string().min(1, "Enter an API key.").max(4096),
  model: z.string().max(200).default(""),
});
export type ModelConfig = z.infer<typeof configSchema>;
export const notesSchema = z
  .array(z.string().trim().min(1).max(400))
  .max(6)
  .default([]);
export const resultSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("message"),
    message: z.string().min(1).max(8000),
  }),
  z.object({
    kind: z.literal("clarification"),
    question: z.string().min(1).max(2000),
  }),
  z.object({
    kind: z.literal("drawing"),
    title: z.string().min(1).max(120),
    summary: z.string().max(3000),
    html: z.string().min(1).max(600_000),
    notes: notesSchema,
  }),
  z.object({
    kind: z.literal("patch"),
    summary: z.string().max(3000),
    patches: z
      .array(
        z.object({
          id: z.string().min(1).max(200),
          svg: z.string().min(1).max(100_000),
        }),
      )
      .min(1)
      .max(40),
  }),
]);
export type AIResult = z.infer<typeof resultSchema>;
export const userInputResultSchema = z
  .object({
    kind: z.literal("request_user_input"),
    content: z.string().max(16000),
    calls: z.array(userInputCallSchema).min(1).max(4),
  })
  .refine(
    ({ calls }) => new Set(calls.map((call) => call.id)).size === calls.length,
  );
export type DrawingResult =
  | AIResult
  | z.infer<typeof userInputResultSchema>
  | z.infer<typeof agentCallsResultSchema>;
export type Drawing = {
  revision?: string;
  title: string;
  html: string;
  svg: string;
  summary: string;
  notes?: string[];
};
export type ElementInfo = {
  id: string;
  tag: string;
  layer: string;
  label: string;
  attributes: Record<string, string>;
};
export type Snapshot = { svg: string; elements: ElementInfo[] };
export type ChatMessage = {
  role: "user" | "assistant";
  text: string;
  id?: string;
  status?: "streaming" | "validating" | "complete" | "cancelled" | "error";
  code?: string;
  received?: number;
  activities?: AgentActivity[];
  reference?: { data: string; name: string };
};

export const drawingRequestSchema = z.object({
  config: configSchema,
  mode: z.enum(["generate", "edit"]),
  instruction: z.string().min(1).max(8000),
  image: z
    .string()
    .max(11_000_000)
    .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/)
    .optional(),
  svg: z.string().max(600_000).optional(),
  selectedId: z.string().max(200).optional(),
  notes: notesSchema,
  source: sourceSchema.optional(),
  agentTurns: z.array(agentTurnSchema).max(16).default([]),
  toolTurns: z.array(userInputTurnSchema).max(12).default([]),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        text: z.string().max(8000),
      }),
    )
    .max(20)
    .default([]),
});
export type DrawingRequest = z.infer<typeof drawingRequestSchema>;
export const pendingUserInputSchema = z
  .object({
    context: drawingRequestSchema.omit({ config: true }),
    request: userInputResultSchema,
    callIndex: z.number().int().min(0),
    responses: z.array(userInputResponseSchema).max(4),
    state: questionnaireSchema,
  })
  .refine((pending) => {
    if (
      pending.callIndex >= pending.request.calls.length ||
      pending.responses.length !== pending.callIndex
    )
      return false;
    const args = userInputArgsSchema.parse(
      JSON.parse(pending.request.calls[pending.callIndex].arguments),
    );
    return (
      pending.state.answers.length === args.questions.length &&
      pending.state.index < args.questions.length &&
      pending.state.answers.every(
        (answer, i) =>
          answer.selected === null ||
          answer.selected <= args.questions[i].options.length,
      )
    );
  });
export type PendingUserInput = z.infer<typeof pendingUserInputSchema>;

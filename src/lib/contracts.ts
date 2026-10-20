import { z } from "zod";
import type { AgentActivity } from "./agent-activity";
import { resourceMetadataSchema } from "./resource-contracts";
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

export const reasoningEffortSchema = z.enum([
  "auto",
  "provider",
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);
export type ReasoningEffort = z.infer<typeof reasoningEffortSchema>;

export const configSchema = z.object({
  baseURL: z.string().min(1).max(2048),
  apiKey: z.string().min(1, "Enter an API key.").max(4096),
  model: z.string().max(200).default(""),
  reasoningEffort: reasoningEffortSchema.optional(),
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
  parentId?: string;
  childIds?: string[];
};
export const selectionSchema = z.object({
  ids: z.array(z.string().min(1).max(200)).max(500),
  rootId: z.string().min(1).max(200).nullable(),
});
export type SelectionState = z.infer<typeof selectionSchema>;
export const EMPTY_SELECTION: SelectionState = { ids: [], rootId: null };
export type Snapshot = { svg: string; elements: ElementInfo[] };
export const attachmentSchema = z.object({
  id: z.string().min(1).max(200),
  name: z.string().min(1).max(500),
  type: z.enum(["image", "svg", "pdf", "dxf", "text"]),
  size: z
    .number()
    .int()
    .min(0)
    .max(8 * 1024 * 1024),
  image: z
    .string()
    .max(11_000_000)
    .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/)
    .optional(),
  text: z
    .string()
    .max(8 * 1024 * 1024)
    .optional(),
  textFormat: z.literal("raw").optional(),
  file: z
    .string()
    .max(11_000_000)
    .regex(/^data:application\/pdf;base64,[A-Za-z0-9+/=]+$/)
    .optional(),
});
export type ChatAttachment = z.infer<typeof attachmentSchema>;
export const attachmentsSchema = z
  .array(attachmentSchema)
  .max(10)
  .refine(
    (items) =>
      items.reduce((sum, item) => sum + item.size, 0) <= 8 * 1024 * 1024,
    "Attachments must total less than 8 MB.",
  )
  .refine(
    (items) =>
      items.reduce(
        (sum, item) =>
          sum +
          (item.image?.length || 0) +
          (item.text?.length || 0) +
          (item.file?.length || 0),
        0,
      ) <= 11_000_000,
    "Processed attachments are too large.",
  );
export type ChatMessage = {
  role: "user" | "assistant";
  text: string;
  id?: string;
  status?:
    | "streaming"
    | "validating"
    | "reviewing"
    | "complete"
    | "cancelled"
    | "error";
  code?: string;
  received?: number;
  activities?: AgentActivity[];
  resumable?: boolean;
  reference?: { data: string; name: string };
  attachments?: ChatAttachment[];
  selectedIds?: string[];
};

export const drawingRequestSchema = z.object({
  recovering: z.boolean().optional(),
  config: configSchema,
  language: z.enum(["en", "zh-CN"]).optional(),
  mode: z.enum(["generate", "edit"]),
  instruction: z.string().min(1).max(8000),
  attachments: attachmentsSchema.optional(),
  resources: z.array(resourceMetadataSchema).max(100).optional(),
  image: z
    .string()
    .max(11_000_000)
    .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/)
    .optional(),
  svg: z.string().max(600_000).optional(),
  selectedId: z.string().max(200).optional(),
  selectedIds: z.array(z.string().min(1).max(200)).max(500).optional(),
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

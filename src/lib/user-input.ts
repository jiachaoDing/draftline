// Adapted from OpenAI Codex (Apache-2.0), revision and license in
// third_party/codex/README.md. Changes: TypeScript state and web validation.
// Copyright 2025 OpenAI
import { z } from "zod";

export const userInputArgsSchema = z
  .object({
    questions: z
      .array(
        z.object({
          id: z.string().min(1).max(100),
          header: z.string().min(1).max(100),
          question: z.string().min(1).max(2000),
          options: z
            .array(
              z.object({
                label: z.string().min(1).max(200),
                description: z.string().max(1000),
              }),
            )
            .min(1)
            .max(3),
        }),
      )
      .min(1)
      .max(3),
  })
  .refine(
    ({ questions }) =>
      new Set(questions.map((q) => q.id)).size === questions.length,
    "Question IDs must be unique",
  );
export const userInputResponseSchema = z.object({
  answers: z.record(
    z.string(),
    z.object({ answers: z.array(z.string().max(8500)).max(2) }),
  ),
});
export const userInputCallSchema = z.object({
  id: z.string().min(1).max(200),
  arguments: z
    .string()
    .max(32000)
    .refine((value) => {
      try {
        return userInputArgsSchema.safeParse(JSON.parse(value)).success;
      } catch {
        return false;
      }
    }, "Invalid request_user_input arguments"),
});
export const userInputTurnSchema = z
  .object({
    content: z.string().max(16000),
    calls: z.array(userInputCallSchema).min(1).max(4),
    responses: z.array(userInputResponseSchema).min(1).max(4),
  })
  .refine(
    (turn) =>
      turn.calls.length === turn.responses.length &&
      new Set(turn.calls.map((call) => call.id)).size === turn.calls.length &&
      turn.calls.every((call, i) => {
        const args = userInputArgsSchema.parse(JSON.parse(call.arguments));
        const keys = Object.keys(turn.responses[i].answers);
        return (
          keys.length === args.questions.length &&
          args.questions.every((q) => keys.includes(q.id))
        );
      }),
    "Tool responses must match all requested questions",
  );
export type UserInputArgs = z.infer<typeof userInputArgsSchema>;
export type UserInputResponse = z.infer<typeof userInputResponseSchema>;
export type UserInputCall = z.infer<typeof userInputCallSchema>;

export const questionnaireSchema = z.object({
  index: z.number().int().min(0),
  answers: z
    .array(
      z.object({
        selected: z.number().int().min(0).nullable(),
        notes: z.string().max(8000),
        committed: z.boolean(),
        notesVisible: z.boolean(),
      }),
    )
    .min(1)
    .max(3),
  confirmUnanswered: z.boolean(),
});
export type Questionnaire = z.infer<typeof questionnaireSchema>;
export function createQuestionnaire(args: UserInputArgs): Questionnaire {
  return {
    index: 0,
    confirmUnanswered: false,
    answers: args.questions.map(() => ({
      selected: 0,
      notes: "",
      committed: false,
      notesVisible: false,
    })),
  };
}
export function collectAnswers(
  args: UserInputArgs,
  state: Questionnaire,
): UserInputResponse {
  return {
    answers: Object.fromEntries(
      args.questions.map((q, i) => {
        const answer = state.answers[i];
        const values: string[] = [];
        if (answer.committed) {
          if (answer.selected !== null)
            values.push(
              q.options[answer.selected]?.label ?? "None of the above",
            );
          if (answer.notes.trim())
            values.push(`user_note: ${answer.notes.trim()}`);
        }
        return [q.id, { answers: values }];
      }),
    ),
  };
}

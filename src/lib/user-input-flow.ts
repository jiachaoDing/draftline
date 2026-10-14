import type { DrawingContext } from "./ai-workflow";
import type { DrawingResult, PendingUserInput } from "./contracts";
import {
  createQuestionnaire,
  userInputArgsSchema,
  type UserInputResponse,
} from "./user-input";

type InputRequest = Extract<DrawingResult, { kind: "request_user_input" }>;

export function questionArgs(request: InputRequest, index: number) {
  return userInputArgsSchema.parse(JSON.parse(request.calls[index].arguments));
}

export function questionText(request: InputRequest) {
  return request.calls
    .flatMap((_, i) =>
      questionArgs(request, i).questions.map((q) => q.question),
    )
    .join("\n");
}

export function pendingQuestions(
  context: DrawingContext,
  request: InputRequest,
): PendingUserInput {
  return {
    context,
    request,
    callIndex: 0,
    responses: [],
    state: createQuestionnaire(questionArgs(request, 0)),
  };
}

/** Keep pending immutable: failed or cancelled continuations retry the same IDs. */
export function answerQuestions(
  pending: PendingUserInput,
  response: UserInputResponse,
):
  | { kind: "next"; pending: PendingUserInput }
  | {
      kind: "resume";
      context: DrawingContext;
      message: { id: string; role: "user"; text: string };
    } {
  const responses = [...pending.responses, response];
  if (pending.callIndex + 1 < pending.request.calls.length) {
    const callIndex = pending.callIndex + 1;
    return {
      kind: "next",
      pending: {
        ...pending,
        callIndex,
        responses,
        state: createQuestionnaire(questionArgs(pending.request, callIndex)),
      },
    };
  }
  const toolTurns = [
    ...pending.context.toolTurns,
    {
      content: pending.request.content,
      calls: pending.request.calls,
      responses,
    },
  ];
  if (toolTurns.length > 12)
    throw new Error(
      "This drawing has reached the clarification limit. Cancel questions and start a new instruction.",
    );
  return {
    kind: "resume",
    context: { ...pending.context, toolTurns },
    message: {
      id: `tool-answer:${pending.request.calls.map((call) => call.id).join(":")}`,
      role: "user",
      text: pending.request.calls
        .flatMap((_, i) =>
          questionArgs(pending.request, i).questions.map(
            (q) =>
              `${q.question}\n${responses[i].answers[q.id].answers.join("\n") || "Unanswered"}`,
          ),
        )
        .join("\n\n"),
    },
  };
}

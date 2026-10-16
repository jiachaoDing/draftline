import { describe, expect, it } from "vitest";
import {
  collectAnswers,
  createQuestionnaire,
  canSubmitAnswer,
  questionnaireSchema,
  userInputArgsSchema,
  userInputTurnSchema,
} from "../src/lib/user-input";
import { pendingUserInputSchema } from "../src/lib/contracts";
import { newProject, projectSchema } from "../src/lib/projects";

export const questions = {
  questions: [
    {
      id: "width",
      header: "Width",
      question: "What is the width?",
      options: [
        { label: "120 mm", description: "Use the stated width." },
        {
          label: "100 mm",
          description: "Use a narrower plate.",
        },
      ],
    },
    {
      id: "height",
      header: "Height",
      question: "What is the height?",
      options: [
        { label: "80 mm", description: "Use the stated height." },
        {
          label: "60 mm",
          description: "Use a shorter plate.",
        },
      ],
    },
  ],
};
describe("Codex user input state and protocol adaptation", () => {
  it("highlights the first option without submitting defaults; serializes committed labels and notes", () => {
    const state = createQuestionnaire(questions);
    expect(state.answers[0].selected).toBe(0);
    expect(collectAnswers(questions, state)).toEqual({
      answers: { width: { answers: [] }, height: { answers: [] } },
    });
    state.answers[0] = {
      selected: 2,
      customAnswer: "  123 mm  ",
      notes: "  Keep R8  ",
      committed: true,
      notesVisible: true,
    };
    state.answers[1].committed = true;
    expect(collectAnswers(questions, state)).toEqual({
      answers: {
        width: { answers: ["123 mm", "user_note: Keep R8"] },
        height: { answers: ["80 mm"] },
      },
    });
  });
  it("accepts text-only measurements and rejects duplicate question IDs and mismatched tool results", () => {
    expect(
      userInputArgsSchema.safeParse({
        questions: [{ ...questions.questions[0], options: [] }],
      }).success,
    ).toBe(true);
    expect(
      userInputArgsSchema.safeParse({
        questions: [questions.questions[0], questions.questions[0]],
      }).success,
    ).toBe(false);
    expect(
      userInputTurnSchema.safeParse({
        content: "",
        calls: [{ id: "call_1", arguments: JSON.stringify(questions) }],
        responses: [{ answers: { width: { answers: ["120 mm"] } } }],
      }).success,
    ).toBe(false);
  });
  it("persists question cursor, drafts, queued calls and the original drawing context without credentials", () => {
    const project = newProject();
    const state = createQuestionnaire(questions);
    state.index = 1;
    state.answers[0] = {
      selected: 1,
      customAnswer: "123 mm",
      notes: "123 mm",
      committed: true,
      notesVisible: true,
    };
    project.userInput = pendingUserInputSchema.parse({
      context: {
        mode: "generate",
        instruction: "Draw a plate",
        config: { apiKey: "secret" },
      },
      request: {
        kind: "request_user_input",
        content: "",
        calls: [{ id: "call_1", arguments: JSON.stringify(questions) }],
      },
      callIndex: 0,
      responses: [],
      state,
    });
    const restored = projectSchema.parse(JSON.parse(JSON.stringify(project)));
    expect(restored.userInput?.state).toEqual(state);
    expect(restored.userInput?.context.instruction).toBe("Draw a plate");
    expect(JSON.stringify(restored)).not.toContain("secret");
    expect(
      pendingUserInputSchema.safeParse({
        ...project.userInput,
        state: { ...state, index: 9 },
      }).success,
    ).toBe(false);
  });

  it("requires actual custom text, keeps notes separate and never serializes the UI label", () => {
    const state = createQuestionnaire(questions);
    const answer = state.answers[0];
    answer.selected = questions.questions[0].options.length;
    answer.notes = "A note alone is not the answer";
    answer.committed = true;
    for (const text of ["", "   ", "\n\t"]) {
      answer.customAnswer = text;
      expect(canSubmitAnswer(questions.questions[0], answer)).toBe(false);
      expect(collectAnswers(questions, state).answers.width.answers).toEqual(
        [],
      );
    }
    answer.customAnswer = "132 mm";
    expect(canSubmitAnswer(questions.questions[0], answer)).toBe(true);
    expect(collectAnswers(questions, state).answers.width.answers).toEqual([
      "132 mm",
      "user_note: A note alone is not the answer",
    ]);
    answer.selected = 0;
    expect(collectAnswers(questions, state).answers.width.answers[0]).toBe(
      "120 mm",
    );
    answer.selected = 99;
    expect(collectAnswers(questions, state).answers.width.answers).toEqual([]);
  });

  it("restores older saved records with an empty custom draft by default", () => {
    const state = createQuestionnaire(questions);
    const { customAnswer: _, ...oldAnswer } = state.answers[0];
    const restored = questionnaireSchema.parse({
      ...state,
      answers: [oldAnswer],
    });
    expect(restored.answers[0].customAnswer).toBe("");
    expect(restored.answers[0].notes).toBe(oldAnswer.notes);
  });
});

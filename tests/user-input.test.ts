import { describe, expect, it } from "vitest";
import {
  collectAnswers,
  createQuestionnaire,
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
          label: "Specify a width",
          description: "Enter a measurement in notes.",
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
          label: "Specify a height",
          description: "Enter a measurement in notes.",
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
      notes: "  123 mm  ",
      committed: true,
      notesVisible: true,
    };
    state.answers[1].committed = true;
    expect(collectAnswers(questions, state)).toEqual({
      answers: {
        width: { answers: ["None of the above", "user_note: 123 mm"] },
        height: { answers: ["80 mm"] },
      },
    });
  });
  it("rejects empty options, duplicate question IDs and mismatched tool results", () => {
    expect(
      userInputArgsSchema.safeParse({
        questions: [{ ...questions.questions[0], options: [] }],
      }).success,
    ).toBe(false);
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
});

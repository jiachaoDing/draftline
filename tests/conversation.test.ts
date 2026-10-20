import { describe, expect, it } from "vitest";
import {
  conversationPath,
  recordConversation,
  restoreConversation,
  runtimeRepository,
} from "../src/lib/conversation";
import { newProject, projectSchema } from "../src/lib/projects";
import { EXAMPLE } from "../src/lib/example";
import type { ChatMessage } from "../src/lib/contracts";

describe("persistent conversation branches and canvases", () => {
  it("retains sibling replies and their descendants through serialization", () => {
    const project = newProject(EXAMPLE);
    const welcome = project.messages[0];
    const user: ChatMessage = {
      id: "user",
      role: "user",
      text: "Change radius",
      canvas: EXAMPLE,
    };
    const first = { ...EXAMPLE, revision: "first", summary: "First" };
    const second = { ...EXAMPLE, revision: "second", summary: "Second" };
    const original = [
      welcome,
      user,
      { id: "first", role: "assistant" as const, text: "First", canvas: first },
      { id: "follow-up", role: "user" as const, text: "More", canvas: first },
    ];
    const graph = recordConversation(
      [
        welcome,
        user,
        { id: "second", role: "assistant", text: "Second", canvas: second },
      ],
      recordConversation(original),
    );
    const restored = projectSchema.parse(
      JSON.parse(
        JSON.stringify({
          ...project,
          messages: conversationPath(graph),
          conversation: graph,
        }),
      ),
    );
    expect(restored.conversation.nodes).toHaveLength(5);
    expect(runtimeRepository(restored.conversation).messages).toHaveLength(5);
    const old = restoreConversation(restored, "follow-up");
    expect(old.messages.map((message) => message.id)).toEqual([
      welcome.id,
      "user",
      "first",
      "follow-up",
    ]);
    expect(old.history.items.at(-1)?.revision).toBe("first");
    expect(
      restoreConversation(old, "second").history.items.at(-1)?.revision,
    ).toBe("second");
  });

  it("restores a blank canvas and retains branch snapshots beyond the undo bound", () => {
    const project = newProject();
    const graph = recordConversation([
      ...project.messages,
      { id: "drawing", role: "assistant", text: "Made", canvas: EXAMPLE },
    ]);
    const current = {
      ...project,
      conversation: graph,
      messages: conversationPath(graph),
      history: { items: Array.from({ length: 30 }, () => EXAMPLE), index: 29 },
    };
    const restored = restoreConversation(current, project.messages[0].id!);
    expect(restored.history.items).toHaveLength(30);
    expect(restored.history.items.at(-1)).toBeNull();
    expect(
      restoreConversation(restored, "drawing").history.items.at(-1)?.svg,
    ).toBe(EXAMPLE.svg);
  });

  it("migrates linear records, matching known drawing summaries and preserving the current canvas", () => {
    const project = newProject(EXAMPLE);
    const restored = projectSchema.parse({
      ...project,
      conversation: undefined,
      messages: [
        { role: "user", text: "Draw" },
        { role: "assistant", text: EXAMPLE.summary },
      ],
    });
    expect(new Set(restored.messages.map((message) => message.id)).size).toBe(
      2,
    );
    expect(restored.messages.at(-1)?.canvas?.svg).toBe(EXAMPLE.svg);
    expect(
      projectSchema.parse(restored).messages.map((message) => message.id),
    ).toEqual(restored.messages.map((message) => message.id));
  });
  it("retains the proposal separately from the committed canvas on reload", () => {
    const project = newProject(EXAMPLE);
    const proposal = {
      ...EXAMPLE,
      svg: EXAMPLE.svg.replaceAll('r="5"', 'r="7"'),
    };
    const messages: ChatMessage[] = [
      ...project.messages,
      {
        id: "review",
        role: "assistant",
        text: "Review",
        status: "reviewing",
        canvas: EXAMPLE,
        proposal,
      },
    ];
    const restored = projectSchema.parse({
      ...project,
      messages,
      conversation: recordConversation(messages),
    });
    expect(restored.messages.at(-1)?.status).toBe("reviewing");
    expect(restored.messages.at(-1)?.proposal?.svg).toContain('r="7"');
    expect(restored.messages.at(-1)?.canvas?.svg).toContain('r="5"');
  });
});

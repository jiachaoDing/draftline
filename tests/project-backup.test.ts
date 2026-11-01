import { expect, it } from "vitest";
import {
  exportProjectBackup,
  importProjectBackup,
} from "../src/lib/project-backup";
import { newProject, projectSchema } from "../src/lib/projects";
import { EXAMPLE } from "../src/lib/example";

it("round trips drawings, history, references and drafts into a separate project", () => {
  const source = newProject(EXAMPLE);
  source.chatInput = "Next edit";
  source.attachments = [
    { id: "note", type: "text", name: "note.txt", size: 5, text: "hello" },
  ];
  const backup = exportProjectBackup({
    ...source,
    config: { apiKey: "private-key" },
  } as typeof source);
  expect(backup).not.toContain("private-key");
  const restored = importProjectBackup(backup, [source.name]);
  expect(restored.id).not.toBe(source.id);
  expect(restored.name).toBe(`${source.name} 2`);
  expect(restored.history).toEqual(projectSchema.parse(source).history);
  expect(restored.conversation).toEqual(
    projectSchema.parse(source).conversation,
  );
  expect(restored.attachments).toEqual(source.attachments);
  expect(restored.chatInput).toBe(source.chatInput);
  expect(() => projectSchema.parse(restored)).not.toThrow();
});

it("rejects unknown versions and invalid drawings without changing the source", () => {
  const backup = JSON.parse(exportProjectBackup(newProject(EXAMPLE)));
  expect(() =>
    importProjectBackup(JSON.stringify({ ...backup, version: 2 }), []),
  ).toThrow();
  backup.project.history.items[0].svg = "<svg/>";
  expect(() => importProjectBackup(JSON.stringify(backup), [])).toThrow();
});

it("preserves long names and gives duplicate copies valid distinct names", () => {
  const project = newProject(null, [], "A".repeat(120));
  const backup = exportProjectBackup(project);
  expect(importProjectBackup(backup, []).name).toBe(project.name);
  const restored = importProjectBackup(backup, [project.name]);
  expect(restored.name).toHaveLength(120);
  expect(restored.name.endsWith(" 2")).toBe(true);
  expect(() => projectSchema.parse(restored)).not.toThrow();
});

it("reassigns interrupted recovery checkpoints across conversation branches", () => {
  const project = newProject(EXAMPLE);
  const message = {
    id: "interrupted",
    role: "assistant" as const,
    text: "Working",
    status: "streaming" as const,
    recovery: {
      projectId: project.id,
      context: {
        mode: "generate" as const,
        instruction: "Draw a plate",
        notes: [],
        agentTurns: [],
        toolTurns: [],
        history: [],
      },
      resources: [],
      round: 1,
      attempt: 0,
    },
  };
  project.messages.push(message);
  const restored = importProjectBackup(exportProjectBackup(project), []);
  expect(restored.messages.at(-1)?.status).toBe("cancelled");
  expect(restored.messages.at(-1)?.recovery?.projectId).toBe(restored.id);
  expect(restored.conversation.nodes.at(-1)?.message.recovery?.projectId).toBe(
    restored.id,
  );
});

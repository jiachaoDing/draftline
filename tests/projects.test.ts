import { beforeEach, describe, expect, it } from "vitest";
import { newProject, projectSchema } from "../src/lib/projects";
import { defaultConfig, readConfig } from "../src/lib/model-settings";
import { EXAMPLE } from "../src/lib/example";

beforeEach(() => localStorage.clear());
describe("local model settings", () => {
  it("restores all settings including the key without altering credentials", () => {
    const config = {
      baseURL: "https://provider.example/v1",
      apiKey: "secret-key",
      model: "vision",
      reasoningEffort: "high",
    };
    localStorage.setItem("draftline-model", JSON.stringify(config));
    expect(readConfig()).toEqual(config);
    localStorage.removeItem("draftline-model");
    expect(readConfig()).toEqual(defaultConfig);
  });
  it("recovers from invalid settings and supports existing URL/model settings", () => {
    localStorage.setItem("draftline-model", "null");
    expect(readConfig()).toEqual(defaultConfig);
    localStorage.setItem(
      "draftline-model",
      JSON.stringify({ model: "vision", baseURL: 123 }),
    );
    expect(readConfig()).toEqual({ ...defaultConfig, model: "vision" });
  });
});
describe("project restoration", () => {
  it("restores message attachments independently of the empty composer and defaults older records", () => {
    const project = newProject();
    project.messages.push({
      role: "user",
      text: "Reference",
      selectedIds: ["hole-top-left"],
      attachments: [
        {
          id: "pdf",
          type: "pdf",
          name: "sheet.pdf",
          size: 4,
          file: "data:application/pdf;base64,JVBERg==",
        },
      ],
    });
    const restored = projectSchema.parse(project);
    expect(restored.messages.at(-1)?.attachments).toEqual(
      project.messages.at(-1)?.attachments,
    );
    expect(restored.attachments).toEqual([]);
    expect(restored.messages.at(-1)?.selectedIds).toEqual(["hole-top-left"]);
    expect(
      projectSchema.parse({ ...project, attachments: undefined }).attachments,
    ).toEqual([]);
    const migrated = projectSchema.parse({
      ...project,
      sketch: { name: "sketch.png", data: "data:image/png;base64,AAAA" },
    });
    expect(migrated.attachments[0]).toMatchObject({
      name: "sketch.png",
      image: "data:image/png;base64,AAAA",
    });
  });
  it("keeps a fixed creation time when restoring and updating saved projects", () => {
    const project = newProject();
    expect(project.createdAt).toBe(project.updatedAt);
    const restored = projectSchema.parse({
      ...project,
      createdAt: undefined,
      updatedAt: 1234,
    });
    expect(restored.createdAt).toBe(1234);
    expect(
      projectSchema.parse({ ...restored, updatedAt: 5678 }).createdAt,
    ).toBe(1234);
  });
  it("gives new drawings distinct names without changing saved names", () => {
    const names = ["Untitled drawing", "untitled DRAWING 2", "Bracket A"];
    expect(newProject(null, names).name).toBe("Untitled drawing 3");
    expect(newProject(EXAMPLE, names).name).toBe(EXAMPLE.title);
    expect(names).toEqual([
      "Untitled drawing",
      "untitled DRAWING 2",
      "Bracket A",
    ]);
  });
  it("starts projects with independent, empty drawing and conversation state", () => {
    const first = newProject();
    const second = newProject();
    first.messages.push({ role: "user", text: "Project A only" });
    expect(first.id).not.toBe(second.id);
    expect(second.history).toEqual({ items: [null], index: 0 });
    expect(second.messages).toHaveLength(1);
  });
  it("restores sanitized drawing snapshots and marks interrupted replies stopped", () => {
    const project = newProject(EXAMPLE);
    project.history.items[0] = {
      ...EXAMPLE,
      html: "<script>unsafe()</script>",
    };
    project.messages.push({
      role: "assistant",
      text: "Partial",
      status: "validating",
    });
    const restored = projectSchema.parse({
      ...project,
      config: { apiKey: "secret" },
    });
    expect(restored.history.items[0]?.html).not.toContain("unsafe");
    expect(restored.messages.at(-1)?.status).toBe("cancelled");
    expect(restored).not.toHaveProperty("config");
  });
  it("rejects invalid history positions and damaged drawings", () => {
    const project = newProject(EXAMPLE);
    expect(
      projectSchema.safeParse({
        ...project,
        history: { ...project.history, index: 8 },
      }).success,
    ).toBe(false);
    expect(() =>
      projectSchema.parse({
        ...project,
        history: { items: [{ ...EXAMPLE, svg: "<svg/>" }], index: 0 },
      }),
    ).toThrow();
  });
});

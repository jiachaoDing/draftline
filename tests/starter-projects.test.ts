import { describe, expect, it } from "vitest";
import records from "../src/lib/starter-projects.json";
import { projectSchema } from "../src/lib/projects";

describe("curated starter projects", () => {
  it("restores the four real drawings with their revisions and reference images", () => {
    const projects = records.map((record) => projectSchema.parse(record));
    expect(projects.map((project) => project.name)).toEqual([
      "样例1",
      "样例2",
      "样例3",
      "样例4",
    ]);
    for (const project of projects) {
      const drawing = project.history.items[project.history.index]!;
      expect(drawing.title).toBe(project.name);
      for (const revision of project.history.items)
        if (revision) expect(revision.title).toBe(project.name);
      expect(drawing.svg).toContain('id="geometry"');
      expect(drawing.svg).toContain('id="dimensions"');
      expect(drawing.html).not.toContain("<script");
      expect(project.history.items.length).toBeGreaterThan(1);
      expect(
        project.messages.some(
          (message) => message.reference || message.attachments?.length,
        ),
      ).toBe(true);
      expect(project.messages.at(-1)?.status).toBe("complete");
    }
  });

  it("contains only finished conversations and successful operation records", () => {
    for (const project of records) {
      expect(project.chatInput).toBe("");
      expect(project.clarification).toBeNull();
      expect(project.userInput).toBeNull();
      for (const message of project.messages) {
        expect(message.text).not.toMatch(
          /streaming connection was interrupted|drawing could not be applied|Questions cancelled|^conti?nue$/i,
        );
        if (message.role === "assistant") {
          expect(message).toHaveProperty("status", "complete");
          expect(
            message.activities?.every(
              (activity) => activity.status === "completed",
            ),
          ).toBe(true);
        }
        expect(message).not.toHaveProperty("code");
      }
      expect(project).not.toHaveProperty("config");
      expect(JSON.stringify(project)).not.toMatch(/apiKey|baseURL|Bearer /);
    }
  });
});

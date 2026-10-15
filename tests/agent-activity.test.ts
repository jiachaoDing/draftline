import { describe, expect, it } from "vitest";
import {
  settleActivities,
  updateActivity,
  type AgentActivity,
} from "../src/lib/agent-activity";
import { projectSchema, newProject } from "../src/lib/projects";

describe("agent activity lifecycle", () => {
  it("keeps call order and prevents late events from reviving completed operations", () => {
    let steps: AgentActivity[] = [];
    steps = updateActivity(steps, {
      id: "read",
      kind: "read_source",
      status: "pending",
    });
    steps = updateActivity(steps, {
      id: "patch",
      kind: "apply_patch",
      status: "pending",
    });
    steps = updateActivity(steps, {
      id: "read",
      kind: "read_source",
      status: "running",
    });
    steps = updateActivity(steps, {
      id: "read",
      kind: "read_source",
      status: "completed",
    });
    steps = updateActivity(steps, {
      id: "read",
      kind: "read_source",
      status: "pending",
    });
    expect(steps.map(({ id, status }) => ({ id, status }))).toEqual([
      { id: "read", status: "completed" },
      { id: "patch", status: "pending" },
    ]);
    expect(
      settleActivities(steps, "failed").map((step) => step.status),
    ).toEqual(["completed", "failed"]);
  });
  it("restores completed and failed details while stopping interrupted work and defaulting old records", () => {
    const project = newProject();
    project.messages.push({
      role: "assistant",
      text: "",
      status: "streaming",
      activities: [
        { id: "read", kind: "read_source", status: "completed" },
        {
          id: "bad",
          kind: "apply_patch",
          status: "failed",
          detail: "Missing context",
        },
        { id: "retry", kind: "apply_patch", status: "running", retry: true },
        { id: "queued", kind: "read_source", status: "pending" },
      ],
    });
    const messages = projectSchema.parse(project).messages;
    expect(messages[0].activities).toEqual([]);
    expect(messages.at(-1)?.status).toBe("cancelled");
    expect(messages.at(-1)?.activities.map((step) => step.status)).toEqual([
      "completed",
      "failed",
      "cancelled",
      "cancelled",
    ]);
    expect(messages.at(-1)?.activities[1].detail).toBe("Missing context");
  });
});

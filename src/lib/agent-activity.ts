import { z } from "zod";

export const activityKindSchema = z.enum([
  "model",
  "prepare",
  "read_source",
  "search_source",
  "apply_patch",
  "validation",
  "request_user_input",
  "tool",
]);
export const toolPendingSchema = z.object({
  index: z.number().int().min(0).max(3),
  name: z.enum([
    "read_source",
    "search_source",
    "apply_patch",
    "request_user_input",
  ]),
});
export type ToolPending = z.infer<typeof toolPendingSchema>;
export const agentActivitySchema = z.object({
  id: z.string().min(1).max(240),
  kind: activityKindSchema,
  status: z.enum(["pending", "running", "completed", "failed", "cancelled"]),
  detail: z.string().max(2000).optional(),
  retry: z.boolean().optional(),
  selected: z.boolean().optional(),
});
export type AgentActivity = z.infer<typeof agentActivitySchema>;
export type ActivityHandler = (activity: AgentActivity) => void;

export function updateActivity(
  activities: AgentActivity[] = [],
  next: AgentActivity,
) {
  const previous = activities.find((activity) => activity.id === next.id);
  // Terminal states cannot be reverted by a late/duplicate stream event.
  if (previous && !["pending", "running"].includes(previous.status))
    return activities;
  return previous
    ? activities.map((activity) =>
        activity.id === next.id ? { ...activity, ...next } : activity,
      )
    : [...activities, next];
}

export function settleActivities(
  activities: AgentActivity[] = [],
  status: "failed" | "cancelled",
) {
  return activities.map((activity) =>
    ["pending", "running"].includes(activity.status)
      ? { ...activity, status }
      : activity,
  );
}

export function activityLabel(activity: AgentActivity) {
  const labels: Record<AgentActivity["kind"], string> = {
    model: "Waiting for model response",
    prepare: "Preparing drawing source",
    read_source: activity.selected
      ? "Inspecting selected element"
      : "Reading drawing source",
    search_source: "Searching drawing source",
    apply_patch: activity.retry
      ? "Retrying failed modification"
      : "Applying patch",
    validation: "Validating drawing",
    request_user_input: "Preparing measurement questions",
    tool: "Executing drawing tool",
  };
  return labels[activity.kind];
}

import { Check, ChevronRight, Circle, CircleAlert, Square } from "lucide-react";
import { activityLabel, type AgentActivity } from "../lib/agent-activity";
import "./agent-activities.css";

function ActivityStep({ activity }: { activity: AgentActivity }) {
  const Icon =
    activity.status === "completed"
      ? Check
      : activity.status === "failed"
        ? CircleAlert
        : activity.status === "cancelled"
          ? Square
          : Circle;
  return (
    <details
      key={activity.status}
      className={`agent-step ${activity.status}`}
      data-activity-id={activity.id}
      data-status={activity.status}
    >
      <summary>
        <Icon size={12} aria-hidden="true" />
        <span>
          {activityLabel(activity)}
          {activity.status === "running" ? "…" : ""}
        </span>
        <small>{activity.status}</small>
        <ChevronRight
          className="activity-chevron"
          size={10}
          aria-hidden="true"
        />
      </summary>
      <p>
        {activity.detail ||
          (activity.status === "pending"
            ? "Queued; execution has not started."
            : "Drawing workflow operation.")}
      </p>
    </details>
  );
}

export default function AgentActivities({
  activities,
  active,
}: {
  activities: AgentActivity[];
  active: boolean;
}) {
  if (!activities.length) return null;
  const current = active
    ? activities.filter((step) => step.status !== "completed")
    : [];
  const finished = active
    ? activities.filter((step) => step.status === "completed")
    : activities;
  const completed = finished.filter(
    (step) => step.status === "completed",
  ).length;
  const failed = finished.filter((step) => step.status === "failed").length;
  const stopped = finished.filter((step) => step.status === "cancelled").length;
  const retries = finished.filter((step) => step.retry).length;
  const latest =
    [...current].reverse().find((step) => step.status === "running") ||
    current.at(-1);
  return (
    <div className="agent-activities" aria-label="Agent activity">
      <span className="activity-announcement" role="status" aria-live="polite">
        {latest
          ? `${activityLabel(latest)} · ${latest.status}`
          : `${completed} activities completed${failed ? `, ${failed} failed` : ""}`}
      </span>
      {finished.length > 0 && (
        <details key={String(active)} className="agent-history">
          <summary>
            Activity · {completed} completed
            {failed > 0 && ` · ${failed} failed`}
            {stopped > 0 && ` · ${stopped} stopped`}
            {retries > 0 && ` · ${retries} retries`}
          </summary>
          {finished.map((activity) => (
            <ActivityStep key={activity.id} activity={activity} />
          ))}
        </details>
      )}
      {current.map((activity) => (
        <ActivityStep key={activity.id} activity={activity} />
      ))}
    </div>
  );
}

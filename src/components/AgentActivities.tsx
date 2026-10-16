import { t, useLocale } from "../lib/i18n";
import { Check, ChevronRight, Circle, CircleAlert, Square } from "lucide-react";
import { activityLabel, type AgentActivity } from "../lib/agent-activity";
import "./agent-activities.css";

function ActivityStep({ activity }: { activity: AgentActivity }) {
  useLocale();
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
          {t(activityLabel(activity))}
          {activity.status === "running" ? "…" : ""}
        </span>
        <small>{t(activity.status)}</small>
        <ChevronRight
          className="activity-chevron"
          size={10}
          aria-hidden="true"
        />
      </summary>
      <p>
        {(activity.detail ? t(activity.detail) : "") ||
          (activity.status === "pending"
            ? t("Queued; execution has not started.")
            : t("Drawing workflow operation."))}
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
  useLocale();
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
    <div className="agent-activities" aria-label={t("Agent activity")}>
      <span className="activity-announcement" role="status" aria-live="polite">
        {latest
          ? `${t(activityLabel(latest))} · ${t(latest.status)}`
          : t("{{count}} activities completed", { count: completed }) +
            (failed ? t(" · {{count}} failed", { count: failed }) : "")}
      </span>
      {finished.length > 0 && (
        <details key={String(active)} className="agent-history">
          <summary>
            {t("Activity · {{count}} completed", { count: completed })}
            {failed > 0 && t(" · {{count}} failed", { count: failed })}
            {stopped > 0 && t(" · {{count}} stopped", { count: stopped })}
            {retries > 0 && t(" · {{count}} retries", { count: retries })}
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

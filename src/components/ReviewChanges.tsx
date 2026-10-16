import { useLocale } from "../lib/i18n";
import type { DrawingChanges } from "../lib/drawing-changes";

export default function ReviewChanges({
  changes,
  summary,
  onApply,
  onDiscard,
}: {
  changes: DrawingChanges;
  summary: string;
  onApply: () => void;
  onDiscard: () => void;
}) {
  const { t } = useLocale();
  return (
    <section
      className="scope-review"
      role="region"
      aria-label={t("Review AI changes")}
    >
      <h3>{t("Review broader AI changes")}</h3>
      <p>{t("Blue: selection · Amber: proposed changes")}</p>
      <p>
        {t(
          "The proposal changes objects beyond your selection. Amber outlines show changed objects. Your saved drawing is unchanged until you apply.",
        )}
      </p>
      <p>
        {t("Proposed changes")}: {summary}
      </p>
      <div className="scope-review-counts">
        {t("{{count}} changed objects", { count: changes.ids.length })} ·{" "}
        {t("{{count}} outside selection", { count: changes.outsideIds.length })}
      </div>
      <ul>
        {changes.metadata?.map((entry) => (
          <li key={entry.label}>
            <strong>{t(entry.label)}</strong>: {entry.before || "∅"} →{" "}
            {entry.after || "∅"}
          </li>
        ))}
        {changes.ids.map((id) => (
          <li key={id}>
            <code>{id}</code>{" "}
            {changes.added.includes(id)
              ? t("Added")
              : changes.removed.includes(id)
                ? t("Removed")
                : t("Changed")}
          </li>
        ))}
      </ul>
      <div className="selection-actions">
        <button className="button primary" onClick={onApply}>
          {t("Apply AI changes")}
        </button>
        <button className="button secondary" onClick={onDiscard}>
          {t("Discard proposal")}
        </button>
      </div>
    </section>
  );
}

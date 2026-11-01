import { useLocale } from "../lib/i18n";
import type { DrawingChanges } from "../lib/drawing-changes";
import type { Drawing } from "../lib/contracts";
import { listElements, sanitizeSVG } from "../lib/drawing";
import { useMemo } from "react";

export default function ReviewChanges({
  changes,
  summary,
  onApply,
  onDiscard,
  before,
  original,
  proposed,
  onView,
}: {
  changes: DrawingChanges;
  summary: string;
  onApply: () => void;
  onDiscard: () => void;
  before: boolean;
  original: Drawing;
  proposed: Drawing;
  onView: (before: boolean, id?: string) => void;
}) {
  const { t } = useLocale();
  const labels = useMemo(
    () =>
      new Map(
        [
          ...listElements(sanitizeSVG(original.svg)),
          ...listElements(sanitizeSVG(proposed.svg)),
        ].map((element) => [element.id, element.label]),
      ),
    [original.svg, proposed.svg],
  );
  return (
    <section
      className="scope-review"
      role="region"
      aria-label={t("Review AI changes")}
    >
      <h3>{t("Review broader AI changes")}</h3>
      <div className="selection-actions" aria-label={t("Compare changes")}>
        <button
          className="button secondary"
          aria-pressed={before}
          onClick={() => onView(true)}
        >
          {t("Before changes")}
        </button>
        <button
          className="button secondary"
          aria-pressed={!before}
          onClick={() => onView(false)}
        >
          {t("Proposed drawing")}
        </button>
      </div>
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
            <button
              className="text-button"
              title={id}
              onClick={() => onView(changes.removed.includes(id), id)}
            >
              {labels.get(id) || id}
            </button>{" "}
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

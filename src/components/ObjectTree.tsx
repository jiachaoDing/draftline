import { useLayoutEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { useLocale } from "../lib/i18n";
import { normalizeSelection } from "../lib/svg-selection";
import type { ElementInfo, SelectionState } from "../lib/contracts";

type Props = {
  elements: ElementInfo[];
  selection: SelectionState;
  onChange: (selection: SelectionState) => void;
  onClose: () => void;
};
export default function ObjectTree({
  elements,
  selection,
  onChange,
  onClose,
}: Props) {
  const { t } = useLocale();
  const list = useRef<HTMLUListElement>(null);
  useLayoutEffect(() => {
    const container = list.current;
    const row = container?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!container || !row) return;
    const bounds = row.getBoundingClientRect();
    const viewport = container.getBoundingClientRect();
    if (bounds.top < viewport.top)
      container.scrollTop += bounds.top - viewport.top;
    else if (bounds.bottom > viewport.bottom)
      container.scrollTop += bounds.bottom - viewport.bottom;
  }, [selection.ids, elements]);
  const rows = (parentId: string, depth = 0): ReactNode =>
    elements
      .filter((element) => element.parentId === parentId)
      .map((element) => (
        <li key={element.id}>
          <button
            type="button"
            className="object-tree-row"
            style={{ paddingLeft: `${8 + depth * 12}px` }}
            aria-pressed={selection.ids.includes(element.id)}
            onClick={(event) =>
              onChange({
                rootId: null,
                ids: normalizeSelection(
                  event.shiftKey
                    ? selection.ids.includes(element.id)
                      ? selection.ids.filter((id) => id !== element.id)
                      : [...selection.ids, element.id]
                    : [element.id],
                  elements,
                ),
              })
            }
            onDoubleClick={() => {
              if (element.tag === "g" && element.layer === "geometry")
                onChange({ ids: [], rootId: element.id });
            }}
          >
            <span>{element.tag === "g" ? "▱" : "·"}</span>
            <span>{element.label}</span>
            <small>{element.tag}</small>
          </button>
          {element.childIds?.length ? (
            <ul>{rows(element.id, depth + 1)}</ul>
          ) : null}
        </li>
      ));
  return (
    <section
      className="object-tree"
      id="canvas-objects"
      aria-label={t("Drawing objects")}
    >
      <header>
        <strong>{t("Objects and groups")}</strong>
        <button aria-label={t("Close objects panel")} onClick={onClose}>
          <X size={14} />
        </button>
      </header>
      <ul ref={list} aria-label={t("SVG hierarchy")}>
        {rows("geometry")}
        {rows("dimensions")}
      </ul>
    </section>
  );
}

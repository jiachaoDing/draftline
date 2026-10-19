import { useLocale } from "../lib/i18n";
import type { ElementInfo, SelectionState } from "../lib/contracts";
import "./selection.css";

type Props = {
  elements: ElementInfo[];
  selection: SelectionState;
  disabled: boolean;
  onChange: (selection: SelectionState) => void;
  onGroup: () => void;
  onUngroup: () => void;
};

export default function SelectionPanel({
  elements,
  selection,
  disabled,
  onChange,
  onGroup,
  onUngroup,
}: Props) {
  const { t } = useLocale();
  const selected = elements.filter((element) =>
    selection.ids.includes(element.id),
  );
  const byId = new Map(elements.map((element) => [element.id, element]));
  const ancestors: ElementInfo[] = [];
  let current = selection.rootId ? byId.get(selection.rootId) : undefined;
  while (current) {
    ancestors.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return (
    <div className="selection-panel">
      <nav
        className="selection-breadcrumbs"
        aria-label={t("Editing hierarchy")}
      >
        <button
          disabled={disabled}
          onClick={() => onChange({ ids: [], rootId: null })}
        >
          {t("Entire drawing")}
        </button>
        {ancestors.map((element) => (
          <span key={element.id}>
            {" "}
            /{" "}
            <button
              disabled={disabled}
              onClick={() => onChange({ ids: [], rootId: element.id })}
            >
              {element.label}
            </button>
          </span>
        ))}
      </nav>
      {selected.length > 0 && (
        <div className="selection-card">
          <div className="selection-heading">
            <span>
              {selected.length === 1
                ? t("SELECTED ELEMENT")
                : t("SELECTED OBJECTS")}
            </span>
            <button
              aria-label={t("Clear selection")}
              disabled={disabled}
              onClick={() => onChange({ ...selection, ids: [] })}
            >
              ×
            </button>
          </div>
          <strong>
            {selected.length === 1
              ? selected[0].label
              : t("{{count}} objects selected", { count: selected.length })}
          </strong>
          <small className="selection-kind">
            {selected.every((element) => element.tag === "g")
              ? t("Groups")
              : t("Objects")}
          </small>
          <div className="selection-actions">
            {selected.length === 1 &&
              selected[0].parentId &&
              byId.has(selected[0].parentId) && (
                <button
                  disabled={disabled}
                  onClick={() => {
                    const parent = byId.get(selected[0].parentId!)!;
                    onChange({
                      ids: [parent.id],
                      rootId:
                        parent.parentId && byId.has(parent.parentId)
                          ? parent.parentId
                          : null,
                    });
                  }}
                >
                  {t("Select parent")}
                </button>
              )}
            <button
              disabled={
                disabled ||
                selected.length < 2 ||
                selected.some(
                  (element) =>
                    element.layer !== "geometry" ||
                    element.parentId !== selected[0].parentId,
                )
              }
              onClick={onGroup}
              title={t(
                "Group at the topmost selected object's stacking position",
              )}
            >
              {t("Group")}
            </button>
            <button
              disabled={
                disabled ||
                selected.some(
                  (element) =>
                    element.tag !== "g" || element.layer !== "geometry",
                )
              }
              onClick={onUngroup}
            >
              {t("Ungroup")}
            </button>
            {selected.length === 1 &&
              selected[0].tag === "g" &&
              selected[0].layer === "geometry" && (
                <button
                  disabled={disabled}
                  onClick={() => onChange({ ids: [], rootId: selected[0].id })}
                >
                  {t("Enter group")}
                </button>
              )}
            {selection.rootId && (
              <button
                disabled={disabled}
                onClick={() => {
                  const node = byId.get(selection.rootId!);
                  onChange({
                    ids: [selection.rootId!],
                    rootId:
                      node?.parentId && byId.has(node.parentId)
                        ? node.parentId
                        : null,
                  });
                }}
              >
                {t("Exit group")}
              </button>
            )}
          </div>
          <p>
            {t(
              "Selection gives AI context. Broader changes are previewed before you apply them.",
            )}
          </p>
        </div>
      )}
      {!selected.length && selection.rootId && (
        <button
          className="text-button"
          disabled={disabled}
          onClick={() =>
            onChange({
              ids: [selection.rootId!],
              rootId: ancestors.at(-2)?.id || null,
            })
          }
        >
          {t("Exit group")}
        </button>
      )}
      <p className="selection-instructions">
        {t(
          "Drag to select · Shift-click to toggle · Double-click to enter · Ctrl/Cmd-click for a detail",
        )}
      </p>
    </div>
  );
}

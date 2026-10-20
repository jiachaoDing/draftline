import type { Drawing } from "./contracts";
import { drawingChanges } from "./drawing-changes";

export function reviewDrawing(base: Drawing, next: Drawing, ids: string[]) {
  const changes = drawingChanges(base.svg, next.svg, ids);
  changes.metadata = [];
  if (base.title !== next.title)
    changes.metadata.push({
      label: "Drawing title",
      before: base.title,
      after: next.title,
    });
  if (JSON.stringify(base.notes || []) !== JSON.stringify(next.notes || []))
    changes.metadata.push({
      label: "Technical notes",
      before: (base.notes || []).join("; "),
      after: (next.notes || []).join("; "),
    });
  return { ...changes, metadata: changes.metadata || [] };
}

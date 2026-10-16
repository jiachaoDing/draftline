import { cleanDrawing, sanitizeSVG } from "./drawing";
import { selectionFamily } from "./svg-selection";

export type DrawingChanges = {
  ids: string[];
  outsideIds: string[];
  added: string[];
  removed: string[];
  metadata?: { label: string; before: string; after: string }[];
};

function structure(node: Element): unknown {
  return {
    tag: node.localName,
    attributes: [...node.attributes]
      .map((attribute) => [attribute.name, attribute.value])
      .sort(([a], [b]) => a.localeCompare(b)),
    children: [...node.childNodes].flatMap((child) =>
      child.nodeType === 1
        ? [(child as Element).id || structure(child as Element)]
        : child.nodeType === 3 && child.textContent?.trim()
          ? [
              node.closest('[xml\\:space="preserve"]')
                ? child.textContent
                : child.textContent.trim().replace(/\s+/g, " "),
            ]
          : [],
    ),
  };
}
function signature(node: Element) {
  return JSON.stringify({
    parent: node.parentElement?.closest("[id]")?.id,
    content: structure(node),
  });
}

export function drawingChanges(
  before: string,
  after: string,
  selectedIds: readonly string[],
): DrawingChanges {
  const old = sanitizeSVG(cleanDrawing(before));
  const next = sanitizeSVG(cleanDrawing(after));
  const oldNodes = new Map(
    [old, ...old.querySelectorAll("[id]")].map((node) => [node.id, node]),
  );
  const nextNodes = new Map(
    [next, ...next.querySelectorAll("[id]")].map((node) => [node.id, node]),
  );
  const ids = [...new Set([...oldNodes.keys(), ...nextNodes.keys()])].filter(
    (id) => {
      const left = oldNodes.get(id),
        right = nextNodes.get(id);
      return !left || !right || signature(left) !== signature(right);
    },
  );
  const family = selectionFamily(old, selectedIds);
  // New descendants of an existing selected object belong to that same target.
  for (const id of selectionFamily(next, selectedIds))
    if (!oldNodes.has(id)) family.add(id);
  return {
    ids,
    outsideIds: selectedIds.length ? ids.filter((id) => !family.has(id)) : [],
    added: ids.filter((id) => !oldNodes.has(id)),
    removed: ids.filter((id) => !nextNodes.has(id)),
  };
}

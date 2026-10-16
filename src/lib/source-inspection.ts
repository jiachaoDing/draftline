import { parse, type DefaultTreeAdapterMap } from "parse5";
import type { VirtualSource } from "./agent-contracts";

type Node = DefaultTreeAdapterMap["node"];
function elementRanges(html: string) {
  const ranges = new Map<
    string,
    {
      start: number;
      end: number;
      related: string[];
      parentId?: string;
      tag: string;
      label?: string;
    }
  >();
  const walk = (node: Node, parentId?: string) => {
    let childParent = parentId;
    if ("attrs" in node) {
      const id = node.attrs.find((a) => a.name === "id")?.value;
      const location = node.sourceCodeLocation;
      if (id && location)
        ranges.set(id, {
          start: location.startLine,
          end: location.endLine,
          related: (
            node.attrs.find((a) => a.name === "data-for")?.value || ""
          ).split(/\s+/),
          parentId,
          tag: node.tagName,
          label: node.attrs
            .find((a) => a.name === "data-label")
            ?.value.slice(0, 120),
        });
      if (id) childParent = id;
    }
    if ("childNodes" in node)
      node.childNodes.forEach((child) => walk(child, childParent));
  };
  walk(parse(html, { sourceCodeLocationInfo: true }));
  return ranges;
}
export function sourceSelectionContext(
  source: VirtualSource,
  selectedIds: readonly string[],
) {
  const ranges = elementRanges(source.html);
  const focused = new Set(selectedIds);
  for (const id of selectedIds) {
    let parent = ranges.get(id)?.parentId;
    while (parent) {
      focused.add(parent);
      parent = ranges.get(parent)?.parentId;
    }
  }
  const ordered = [...ranges].sort(
    ([a], [b]) => Number(focused.has(b)) - Number(focused.has(a)),
  );
  const objects: {
    id: string;
    parentId?: string;
    tag: string;
    label?: string;
    start: number;
    end: number;
    related: string[];
  }[] = [];
  let length = 0;
  for (const [id, range] of ordered) {
    const entry = { id, ...range };
    length += JSON.stringify(entry).length;
    if (length > 20000 || objects.length >= 120) break;
    objects.push(entry);
  }
  return {
    selected_ids: selectedIds,
    objects,
    truncated: objects.length < ranges.size,
  };
}
export function sourceInfo(source: VirtualSource) {
  return {
    file_path: source.path,
    revision: source.revision,
    lines: source.html.split("\n").length,
  };
}
export function readSource(
  source: VirtualSource,
  offset: number,
  limit: number,
  elementId?: string,
) {
  const lines = source.html.split("\n");
  let starts = [offset];
  if (elementId) {
    const ranges = elementRanges(source.html);
    const range = ranges.get(elementId);
    if (!range)
      throw new Error(`Element ${elementId} was not found in drawing.html.`);
    const descendantIds = [...ranges]
      .filter(([, r]) => r.start >= range.start && r.end <= range.end)
      .map(([id]) => id);
    starts = [
      Math.max(1, range.start - 3) + offset - 1,
      ...[...ranges.values()]
        .filter((r) => r.related.some((id) => descendantIds.includes(id)))
        .filter(() => offset === 1)
        .map((r) => Math.max(1, r.start - 3)),
    ];
  }
  const text = [...new Set(starts)]
    .map((start) => {
      if (start > lines.length)
        throw new Error("Offset is beyond the end of drawing.html.");
      return lines
        .slice(start - 1, start - 1 + limit)
        .map((line, i) => `L${start + i}: ${line}`)
        .join("\n");
    })
    .join("\n\n");
  return {
    ...sourceInfo(source),
    text: text.slice(0, 32_000),
    truncated: text.length > 32_000,
    structure: elementId
      ? sourceSelectionContext(source, [elementId])
      : undefined,
  };
}
export function searchSource(source: VirtualSource, query: string) {
  const matches = source.html
    .split("\n")
    .flatMap((line, i) => (line.includes(query) ? [`L${i + 1}: ${line}`] : []));
  return {
    ...sourceInfo(source),
    text: matches.slice(0, 40).join("\n").slice(0, 32_000),
    matches: matches.length,
  };
}

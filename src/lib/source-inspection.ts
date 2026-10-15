import { parse, type DefaultTreeAdapterMap } from "parse5";
import type { VirtualSource } from "./agent-contracts";

type Node = DefaultTreeAdapterMap["node"];
function elementRanges(html: string) {
  const ranges = new Map<
    string,
    { start: number; end: number; related: string[] }
  >();
  const walk = (node: Node) => {
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
        });
    }
    if ("childNodes" in node) node.childNodes.forEach(walk);
  };
  walk(parse(html, { sourceCodeLocationInfo: true }));
  return ranges;
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

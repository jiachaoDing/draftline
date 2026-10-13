export type SheetInfo = { title?: string; notes?: string[] };
export type TextMeasure = (
  text: string,
  size: number,
  weight: number,
) => number;
const NS = "http://www.w3.org/2000/svg";
let context: CanvasRenderingContext2D | null;
const measureText: TextMeasure = (text, size, weight) => {
  context ||= document.createElement("canvas").getContext("2d");
  if (!context) throw new Error("Text layout is unavailable in this browser.");
  context.font = `${weight} ${size}px Arial`;
  return context.measureText(text).width;
};

function wrap(
  text: string,
  width: number,
  size: number,
  weight: number,
  measure: TextMeasure,
) {
  const lines: string[] = [];
  let line = "";
  for (const word of text.trim().split(/\s+/u)) {
    const candidate = line ? `${line} ${word}` : word;
    if (measure(candidate, size, weight) <= width) {
      line = candidate;
      continue;
    }
    if (line) {
      lines.push(line);
      line = "";
    }
    for (const { segment } of new Intl.Segmenter(undefined, {
      granularity: "grapheme",
    }).segment(word)) {
      if (line && measure(line + segment, size, weight) > width) {
        lines.push(line);
        line = "";
      }
      line += segment;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : ["Technical drawing"];
}

/** Presentation is derived from the canonical SVG, never baked into manufacturing geometry. */
export function removePresentation(svg: SVGSVGElement) {
  const group = [...svg.children].find((node) => node.id === "presentation");
  if (!group) return svg;
  const box = (group.getAttribute("data-source-viewbox") || "")
    .split(/\s+/)
    .map(Number);
  if (
    box.length !== 4 ||
    box.some((n) => !Number.isFinite(n)) ||
    box[2] <= 0 ||
    box[3] <= 0
  )
    throw new Error("The sheet has invalid source bounds.");
  svg.setAttribute("viewBox", box.join(" "));
  svg.setAttribute("width", `${box[2]}mm`);
  svg.setAttribute("height", `${box[3]}mm`);
  group.remove();
  return svg;
}

export function addPresentation(
  svg: SVGSVGElement,
  info: SheetInfo = {},
  measure: TextMeasure = measureText,
) {
  removePresentation(svg);
  const box = svg
    .getAttribute("viewBox")!
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  const [sourceX, sourceY, sourceWidth, sourceHeight] = box;
  const width = Math.max(120, sourceWidth);
  const x = sourceX - (width - sourceWidth) / 2;
  const margin = 8;
  const left = x + margin,
    innerWidth = width - margin * 2;
  const top = sourceY + sourceHeight + 6;
  const sideBySide = width >= 156;
  const titleWidth = sideBySide ? Math.min(80, innerWidth * 0.43) : innerWidth;
  const titleX = sideBySide ? left + innerWidth - titleWidth : left;
  const notesWidth = sideBySide ? innerWidth - titleWidth - 10 : innerWidth;
  const title =
    info.title?.trim() ||
    [...svg.children]
      .find((node) => node.localName === "title")
      ?.textContent?.trim() ||
    "Technical drawing";
  const suppliedNotes = [
    ...new Set((info.notes || []).map((note) => note.trim()).filter(Boolean)),
  ];
  const hasDimensions = Boolean(
    svg.querySelector("#dimensions")?.children.length,
  );
  const guidance = hasDimensions
    ? ["Use stated dimensions; do not scale the drawing."]
    : suppliedNotes.length
      ? []
      : ["Geometry is supplied at actual size."];
  const notes = [...new Set([...guidance, ...suppliedNotes])];
  const titleLines = wrap(title, titleWidth, 4.2, 600, measure);
  const noteLines = notes.map((note) =>
    wrap(note, notesWidth - 5, 2.7, 400, measure),
  );
  const titleBottom = top + 13 + (titleLines.length - 1) * 5.6;
  const metadataY = titleBottom + 9;
  const notesLabelY = sideBySide ? top + 6 : metadataY + 14;
  const notesBottom =
    notesLabelY +
    6 +
    (noteLines.reduce((count, lines) => count + lines.length, 0) - 1) * 4.5 +
    (notes.length - 1) * 2;
  const bottom = Math.max(notesBottom + 6, metadataY + 11);
  const group = svg.ownerDocument.createElementNS(NS, "g");
  group.id = "presentation";
  group.setAttribute("data-layer", "presentation");
  group.setAttribute("data-source-viewbox", box.join(" "));
  group.setAttribute("font-family", "Arial, sans-serif");
  group.setAttribute("fill", "#455269");
  group.setAttribute("stroke", "none");
  group.setAttribute("pointer-events", "none");
  const node = (
    tag: string,
    attributes: Record<string, string | number>,
    text?: string,
  ) => {
    const element = svg.ownerDocument.createElementNS(NS, tag);
    Object.entries(attributes).forEach(([key, value]) =>
      element.setAttribute(key, String(value)),
    );
    if (text !== undefined) element.textContent = text;
    group.append(element);
    return element;
  };
  const rule = (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    heavy = false,
  ) =>
    node("line", {
      x1,
      y1,
      x2,
      y2,
      stroke: heavy ? "#34445c" : "#d5dce6",
      "stroke-width": heavy ? 0.25 : 0.16,
    });
  const label = (text: string, atX: number, atY: number, field: string) =>
    node(
      "text",
      {
        x: atX,
        y: atY,
        "font-size": 2,
        "font-weight": 600,
        "letter-spacing": 0.25,
        fill: "#768398",
        "data-field": field,
      },
      text,
    );
  rule(left, top, left + innerWidth, top, true);
  rule(left, bottom, left + innerWidth, bottom);
  if (sideBySide) rule(titleX - 5, top + 5, titleX - 5, bottom - 5);
  label("DRAWING TITLE", titleX, top + 6, "title-label");
  titleLines.forEach((line, index) =>
    node(
      "text",
      {
        x: titleX,
        y: top + 13 + index * 5.6,
        "font-size": 4.2,
        "font-weight": 600,
        fill: "#25364c",
        "data-field": "title",
      },
      line,
    ),
  );
  const unitsX = titleX,
    scaleX = titleX + titleWidth * 0.55;
  label("UNITS", unitsX, metadataY, "units-label");
  label("SCALE", scaleX, metadataY, "scale-label");
  node(
    "text",
    { x: unitsX, y: metadataY + 5, "font-size": 3.1, "data-field": "units" },
    "mm",
  );
  node(
    "text",
    { x: scaleX, y: metadataY + 5, "font-size": 3.1, "data-field": "scale" },
    "1:1",
  );
  label("TECHNICAL NOTES", left, notesLabelY, "notes-label");
  let noteY = notesLabelY + 6;
  noteLines.forEach((lines, index) => {
    node(
      "text",
      { x: left, y: noteY, "font-size": 2.7, fill: "#8794a7" },
      `${index + 1}.`,
    );
    lines.forEach((line) => {
      node(
        "text",
        { x: left + 5, y: noteY, "font-size": 2.7, "data-field": "note" },
        line,
      );
      noteY += 4.5;
    });
    noteY += 2;
  });
  svg.append(group);
  const height = bottom + margin - sourceY;
  svg.setAttribute("viewBox", [x, sourceY, width, height].join(" "));
  svg.setAttribute("width", `${width}mm`);
  svg.setAttribute("height", `${height}mm`);
  return svg;
}

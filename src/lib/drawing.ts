import DOMPurify from "dompurify";
import type { AIResult, ElementInfo } from "./contracts";

const SHAPES = "path,circle,ellipse,rect,line,polygon,polyline,text,use";
const OBJECTS = `${SHAPES},g`;

export function ensureObjectIds(svg: SVGSVGElement) {
  const ids = new Set([...svg.querySelectorAll("[id]")].map((node) => node.id));
  let counter = 1;
  for (const node of svg.querySelectorAll("#geometry :is(g,text,use)")) {
    if (node.id || node.closest("defs,clipPath,mask")) continue;
    let id: string;
    do {
      id = `object-${node.localName}-${counter++}`;
    } while (ids.has(id));
    node.id = id;
    ids.add(id);
  }
  return svg;
}
export function sanitizeSVG(source: string): SVGSVGElement {
  const clean = DOMPurify.sanitize(source, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_TAGS: ["use"],
    ADD_ATTR: ["data-layer", "data-for", "data-label", "data-resource-id"],
    FORBID_TAGS: [
      "script",
      "style",
      "foreignObject",
      "image",
      "a",
      "animate",
      "animateMotion",
      "animateTransform",
      "set",
      "feImage",
    ],
    FORBID_ATTR: ["style"],
  });
  const doc = new DOMParser().parseFromString(clean, "image/svg+xml");
  const svg = doc.documentElement;
  if (doc.querySelector("parsererror") || svg.localName !== "svg")
    throw new Error("The model did not produce valid SVG. Try again.");
  for (const node of [svg, ...svg.querySelectorAll("*")]) {
    for (const attr of [...node.attributes]) {
      if (
        (/href$/i.test(attr.name) && !/^#[\w.-]+$/.test(attr.value)) ||
        (/url\s*\(/i.test(attr.value) &&
          !/^url\(\s*#[\w.-]+\s*\)$/.test(attr.value))
      )
        node.removeAttribute(attr.name);
    }
  }
  return svg as unknown as SVGSVGElement;
}

export function validateSVG(svg: SVGSVGElement) {
  const mm = (name: string) => {
    const value = svg.getAttribute(name) || "";
    if (!/^\d+(?:\.\d+)?mm$/.test(value))
      throw new Error(
        "Drawing width and height must use explicit millimeter units.",
      );
    return Number(value.slice(0, -2));
  };
  const width = mm("width"),
    height = mm("height");
  const box = (svg.getAttribute("viewBox") || "")
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (
    box.length !== 4 ||
    box.some((n) => !Number.isFinite(n)) ||
    width <= 0 ||
    height <= 0 ||
    width > 100000 ||
    height > 100000 ||
    Math.abs(box[2] - width) > 0.0001 ||
    Math.abs(box[3] - height) > 0.0001 ||
    svg.hasAttribute("transform")
  ) {
    throw new Error(
      "SVG scale must be exactly one coordinate unit per millimeter.",
    );
  }
  const geometry = [...svg.children].find((n) => n.id === "geometry");
  const dimensions = [...svg.children].find((n) => n.id === "dimensions");
  if (
    svg.id !== "drawing" ||
    geometry?.localName !== "g" ||
    dimensions?.localName !== "g" ||
    geometry.getAttribute("data-layer") !== "geometry" ||
    dimensions.getAttribute("data-layer") !== "dimensions"
  ) {
    throw new Error(
      "The drawing needs separate geometry and dimension groups.",
    );
  }
  if (
    [...svg.querySelectorAll("svg")].some(
      (node) => !node.closest("#geometry [data-resource-id]"),
    ) ||
    [...svg.children].some(
      (n) =>
        !["defs", "title", "desc"].includes(n.localName) &&
        n !== geometry &&
        n !== dimensions,
    )
  )
    throw new Error("All drawing elements must belong to a drawing layer.");
  if (!geometry.querySelector(SHAPES))
    throw new Error("The drawing contains no vector geometry.");
  const ids = new Set<string>();
  for (const node of [svg, ...svg.querySelectorAll("[id]")]) {
    if (!/^[a-zA-Z][\w.-]*$/.test(node.id) || ids.has(node.id))
      throw new Error("Drawing element IDs must be unique and descriptive.");
    ids.add(node.id);
  }
  for (const node of geometry.querySelectorAll(SHAPES))
    if (!node.id)
      throw new Error("Every geometry element needs an ID for selection.");
  for (const node of dimensions.children) {
    if (node.localName !== "g" || !node.id || !node.getAttribute("data-for"))
      throw new Error(
        "Each dimension needs a group ID and a data-for geometry reference.",
      );
    if (
      node
        .getAttribute("data-for")!
        .split(/\s+/)
        .some(
          (id) =>
            ![...geometry.querySelectorAll("[id]")].some((el) => el.id === id),
        )
    )
      throw new Error("Dimension references must point to existing geometry.");
  }
  return svg;
}

export function cleanDrawing(source: string) {
  return serialize(validateSVG(ensureObjectIds(sanitizeSVG(source))));
}
export function serialize(svg: Element) {
  return new XMLSerializer().serializeToString(svg);
}
export function svgToHTML(svg: string) {
  return `<!doctype html><html><body>${svg}</body></html>`;
}

export function listElements(svg: SVGSVGElement): ElementInfo[] {
  return [
    ...svg.querySelectorAll(
      `#geometry :is(${OBJECTS})[id],#dimensions > g[id]`,
    ),
  ]
    .filter((node) => !node.closest("defs,clipPath,mask"))
    .map((node) => ({
      id: node.id,
      tag: node.localName,
      layer:
        node.closest("[data-layer]")?.getAttribute("data-layer") || "geometry",
      label: node.getAttribute("data-label") || node.id.replace(/[-_]/g, " "),
      attributes: Object.fromEntries(
        [...node.attributes]
          .filter(
            (a) => !["id", "data-for", "data-layer", "xmlns"].includes(a.name),
          )
          .map((a) => [a.name, a.value]),
      ),
      parentId: node.parentElement?.closest("g[id]")?.id,
      childIds: [...node.children]
        .filter((child) => child.matches(OBJECTS) && child.id)
        .map((child) => child.id),
    }));
}

export function applyPatches(
  source: string,
  patches: Extract<AIResult, { kind: "patch" }>["patches"],
) {
  const svg = validateSVG(sanitizeSVG(source));
  const patched = new Set<string>();
  for (const patch of patches) {
    const old = [...svg.querySelectorAll("[id]")].find(
      (el) => el.id === patch.id,
    );
    if (
      !old ||
      ["drawing", "geometry", "dimensions"].includes(patch.id) ||
      patched.has(patch.id) ||
      [...old.querySelectorAll("[id]")].some((child) => patched.has(child.id))
    )
      throw new Error("Patch targets must be existing, distinct object IDs.");
    let parent = old.parentElement;
    while (parent && parent.id !== "drawing") {
      if (patched.has(parent.id))
        throw new Error("Patch targets must not overlap.");
      parent = parent.parentElement;
    }
    patched.add(patch.id);
    const wrapper = sanitizeSVG(
      `<svg xmlns="http://www.w3.org/2000/svg">${patch.svg}</svg>`,
    );
    const replacement = wrapper.firstElementChild;
    if (
      wrapper.children.length !== 1 ||
      !replacement ||
      replacement.id !== patch.id ||
      replacement.localName !== old.localName
    )
      throw new Error("The edit must preserve element IDs and types.");
    const newIds = new Set([
      replacement.id,
      ...[...replacement.querySelectorAll("[id]")].map((el) => el.id),
    ]);
    if ([...old.querySelectorAll("[id]")].some((el) => !newIds.has(el.id)))
      throw new Error(
        "The edit removed a stable element ID. Try a whole-drawing edit.",
      );
    // XMLSerializer adds xmlns to standalone fragments. The drawing root
    // already provides this namespace; avoid a spurious attribute-only edit.
    for (const node of [replacement, ...replacement.querySelectorAll("*")])
      if (node.getAttribute("xmlns") === svg.namespaceURI)
        node.removeAttribute("xmlns");
    old.replaceWith(replacement);
  }
  return serialize(validateSVG(svg));
}

export function exportSVG(source: string) {
  const left = validateSVG(sanitizeSVG(source));
  const right = left.cloneNode(true) as SVGSVGElement;
  const [x, y, width, height] = left
    .getAttribute("viewBox")!
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  const gap = 10;
  const svg = left.ownerDocument.createElementNS(left.namespaceURI, "svg");
  svg.setAttribute("width", `${width * 2 + gap}mm`);
  svg.setAttribute("height", `${height}mm`);
  svg.setAttribute("viewBox", [x, y, width * 2 + gap, height].join(" "));
  left.querySelector("#dimensions")!.remove();
  // Each copy owns its definitions and fragment references, including imported SVGs.
  let prefix = "annotated-";
  const originalIds = [left, ...left.querySelectorAll("[id]")].map(
    (node) => node.id,
  );
  while (originalIds.some((id) => id.startsWith(prefix)))
    prefix = `copy-${prefix}`;
  const ids = new Map<string, string>();
  for (const node of [right, ...right.querySelectorAll("[id]")]) {
    ids.set(node.id, `${prefix}${node.id}`);
    node.id = ids.get(node.id)!;
  }
  for (const node of [right, ...right.querySelectorAll("*")]) {
    for (const attr of [...node.attributes]) {
      if (/href$/i.test(attr.name) && attr.value.startsWith("#")) {
        const id = ids.get(attr.value.slice(1));
        if (id) node.setAttribute(attr.name, `#${id}`);
      } else if (/url\s*\(/i.test(attr.value)) {
        node.setAttribute(
          attr.name,
          attr.value.replace(/url\(\s*#([\w.-]+)\s*\)/g, (value, id: string) =>
            ids.has(id) ? `url(#${ids.get(id)})` : value,
          ),
        );
      }
    }
  }
  left.setAttribute("x", String(x));
  right.setAttribute("x", String(x + width + gap));
  for (const panel of [left, right]) {
    panel.setAttribute("width", String(width));
    panel.setAttribute("height", String(height));
    panel.setAttribute("y", String(y));
    svg.append(panel);
  }
  svg.querySelectorAll("[data-for],[data-label]").forEach((el) => {
    el.removeAttribute("data-for");
    el.removeAttribute("data-label");
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n${serialize(svg)}`;
}

export function downloadFile(content: BlobPart, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

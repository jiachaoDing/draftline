import { generate, parse, type CssNode } from "css-tree";
import { calculate, compare } from "specificity";
import { sanitizeSVG, serialize } from "./drawing";

// Convert a static SVG's presentation CSS to attributes before the shared sanitizer.
// No stylesheet is attached to the document, and no external CSS is loaded.
const presentation = new Set(
  "fill fill-opacity fill-rule stroke stroke-width stroke-opacity stroke-linecap stroke-linejoin stroke-miterlimit stroke-dasharray stroke-dashoffset opacity color clip-path clip-rule mask filter font-family font-size font-style font-weight text-anchor dominant-baseline alignment-baseline letter-spacing word-spacing stop-color stop-opacity flood-color flood-opacity visibility display overflow vector-effect paint-order shape-rendering color-interpolation-filters".split(
    " ",
  ),
);

export function sanitizeResourceSvg(source: string) {
  const doc = new DOMParser().parseFromString(source, "image/svg+xml");
  const root = doc.documentElement;
  if (doc.querySelector("parsererror") || root.localName !== "svg")
    throw new Error("This resource is not a valid SVG.");
  if (root.querySelectorAll("*").length > 50000)
    throw new Error("SVG resources may contain at most 50,000 elements.");
  const rules: {
    selector: string;
    declarations: CssNode[];
    specificity: ReturnType<typeof calculate>;
  }[] = [];
  for (const style of root.querySelectorAll("style")) {
    if ((style.textContent || "").length > 100000)
      throw new Error(
        "SVG stylesheets must be smaller than 100,000 characters.",
      );
    const tree = parse(style.textContent || "");
    if (tree.type === "StyleSheet")
      for (const rule of tree.children) {
        if (rule.type !== "Rule" || rule.prelude.type !== "SelectorList")
          continue;
        for (const selector of rule.prelude.children) {
          const value = generate(selector);
          if (rules.length >= 1000)
            throw new Error(
              "SVG resources may contain at most 1,000 CSS selectors.",
            );
          try {
            rules.push({
              selector: value,
              declarations: rule.block.children.toArray(),
              specificity: calculate(value),
            });
          } catch {
            /* Unsupported static selectors are ignored. */
          }
        }
      }
    style.remove();
  }
  rules.sort((a, b) => compare(a.specificity, b.specificity));
  const priorities = new WeakMap<Element, Set<string>>();
  const apply = (node: Element, declarations: CssNode[]) => {
    for (const item of declarations) {
      if (item.type !== "Declaration" || !presentation.has(item.property))
        continue;
      const value = generate(item.value);
      // Only fragment paint/filter/clip references are permitted, never network/data URLs.
      if (/url\s*\(/i.test(value) && !/^url\(#[\w.-]+\)$/.test(value)) continue;
      if (/\\|var\(|expression\(|@/i.test(value)) continue;
      const important = priorities.get(node) || new Set<string>();
      if (important.has(item.property) && !item.important) continue;
      if (item.important) important.add(item.property);
      priorities.set(node, important);
      node.setAttribute(item.property, value);
    }
  };
  for (const rule of rules) {
    try {
      if (root.matches(rule.selector)) apply(root, rule.declarations);
      for (const node of root.querySelectorAll(rule.selector))
        apply(node, rule.declarations);
    } catch {
      /* Invalid selectors cannot affect another document. */
    }
  }
  for (const node of [root, ...root.querySelectorAll("[style]")]) {
    const style = node.getAttribute("style");
    if (!style) continue;
    const tree = parse(style, { context: "declarationList" });
    if (tree.type === "DeclarationList") apply(node, tree.children.toArray());
    node.removeAttribute("style");
  }
  return sanitizeSVG(serialize(root));
}

export function svgResourceMetadata(svg: SVGSVGElement) {
  const box = (svg.getAttribute("viewBox") || "")
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  const length = (name: string) => {
    const match = svg
      .getAttribute(name)
      ?.trim()
      .match(/^([\d.]+)(px|mm|cm|in|pt|pc|q)?$/i);
    if (!match) return undefined;
    const units: Record<string, number> = {
      px: 1,
      mm: 96 / 25.4,
      cm: 96 / 2.54,
      in: 96,
      pt: 96 / 72,
      pc: 16,
      q: 96 / 101.6,
    };
    const value = Number(match[1]) * units[match[2]?.toLowerCase() || "px"];
    return Number.isFinite(value) && value > 0 ? value : undefined;
  };
  const width = length("width");
  const height = length("height");
  const validBox =
    box.length === 4 && box.every(Number.isFinite) && box[2] > 0 && box[3] > 0;
  return {
    width,
    height,
    units: width && height ? "px" : "user units",
    viewBox: validBox ? (box as [number, number, number, number]) : undefined,
  };
}

export function reusableSvg(source: string, prefix: string) {
  const svg = sanitizeResourceSvg(source);
  const defaults: Record<string, string> = {
    fill: "black",
    "fill-opacity": "1",
    "fill-rule": "nonzero",
    stroke: "none",
    "stroke-width": "1",
    "stroke-opacity": "1",
    "stroke-linecap": "butt",
    "stroke-linejoin": "miter",
    "stroke-miterlimit": "4",
    "stroke-dasharray": "none",
    "stroke-dashoffset": "0",
    color: "black",
    "font-family": "serif",
    "font-size": "16",
    "font-style": "normal",
    "font-weight": "normal",
    "text-anchor": "start",
    "letter-spacing": "normal",
    "word-spacing": "normal",
    "marker-start": "none",
    "marker-mid": "none",
    "marker-end": "none",
    visibility: "visible",
    "paint-order": "normal",
  };
  for (const [name, value] of Object.entries(defaults))
    if (!svg.hasAttribute(name)) svg.setAttribute(name, value);
  const info = svgResourceMetadata(svg);
  const box =
    info.viewBox ||
    (info.width && info.height ? [0, 0, info.width, info.height] : undefined);
  if (!box)
    throw new Error(
      "SVG placement requires a positive viewBox or explicit width and height. Ask the user for the missing dimensions.",
    );
  const ids = new Map<string, string>();
  let index = 0;
  for (const node of [svg, ...svg.querySelectorAll("*")]) {
    const id = `${prefix}-part-${++index}`;
    if (node.id) {
      if (ids.has(node.id))
        throw new Error("SVG resource contains duplicate IDs.");
      ids.set(node.id, id);
    }
    node.id = id;
    node.removeAttribute("data-layer");
    node.removeAttribute("data-for");
    node.removeAttribute("class");
  }
  for (const node of [svg, ...svg.querySelectorAll("*")])
    for (const attr of [...node.attributes]) {
      const ref = /href$/i.test(attr.name)
        ? attr.value.slice(1)
        : attr.value.match(/^url\(\s*#([\w.-]+)\s*\)$/)?.[1];
      if (!ref) continue;
      const target = ids.get(ref);
      if (!target) node.removeAttribute(attr.name);
      else
        node.setAttribute(
          attr.name,
          /href$/i.test(attr.name) ? `#${target}` : `url(#${target})`,
        );
    }
  svg.setAttribute("viewBox", box.join(" "));
  svg.setAttribute("x", "0");
  svg.setAttribute("y", "0");
  const width = info.width && info.height ? info.width : box[2];
  const height = info.width && info.height ? info.height : box[3];
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  return { svg, width, height, ids };
}

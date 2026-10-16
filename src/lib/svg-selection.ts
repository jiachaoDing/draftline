import type { ElementInfo } from "./contracts";
import { cleanDrawing, sanitizeSVG, serialize } from "./drawing";

export const OBJECT_SELECTOR =
  "g,path,circle,ellipse,rect,line,polygon,polyline,text,use";

export function normalizeSelection(
  ids: readonly string[],
  elements: ElementInfo[],
) {
  const selected = new Set(ids);
  const byId = new Map(elements.map((element) => [element.id, element]));
  return [...selected].filter((id) => {
    if (!byId.has(id)) return false;
    let parent = byId.get(id)?.parentId;
    while (parent) {
      if (selected.has(parent)) return false;
      parent = byId.get(parent)?.parentId;
    }
    return true;
  });
}

export function selectionFamily(svg: SVGSVGElement, ids: readonly string[]) {
  const family = new Set<string>();
  for (const node of svg.querySelectorAll("[id]")) {
    if (!ids.includes(node.id)) continue;
    family.add(node.id);
    node.querySelectorAll("[id]").forEach((child) => family.add(child.id));
  }
  for (const dimension of svg.querySelectorAll("#dimensions > g[data-for]")) {
    if (
      dimension
        .getAttribute("data-for")!
        .split(/\s+/)
        .some((id) => family.has(id))
    ) {
      family.add(dimension.id);
      dimension
        .querySelectorAll("[id]")
        .forEach((child) => family.add(child.id));
    }
  }
  return family;
}

function selectedNodes(svg: SVGSVGElement, ids: readonly string[]) {
  return [
    ...svg.querySelectorAll(`#geometry :is(${OBJECT_SELECTOR})[id]`),
  ].filter((node) => ids.includes(node.id));
}

export function groupObjects(
  source: string,
  ids: readonly string[],
  label = "Group",
) {
  const svg = sanitizeSVG(cleanDrawing(source));
  const nodes = selectedNodes(svg, ids);
  if (
    nodes.length < 2 ||
    nodes.length !== ids.length ||
    nodes.some((node) => node.parentElement !== nodes[0].parentElement)
  )
    throw new Error(
      "Select at least two objects in the same group to group them.",
    );
  const group = svg.ownerDocument.createElementNS(svg.namespaceURI, "g");
  group.id = `object-${crypto.randomUUID()}`;
  group.setAttribute("data-label", label);
  // Vector-editor convention: place the group at its topmost selected member.
  nodes.at(-1)!.before(group);
  group.append(...nodes);
  return { svg: cleanDrawing(serialize(svg)), ids: [group.id] };
}

export function ungroupObjects(source: string, ids: readonly string[]) {
  const svg = sanitizeSVG(cleanDrawing(source));
  const groups = selectedNodes(svg, ids);
  if (
    !groups.length ||
    groups.length !== ids.length ||
    groups.some((group) => group.localName !== "g")
  )
    throw new Error("Select object groups to ungroup them.");
  const nextIds: string[] = [];
  for (const group of groups) {
    if (
      ["clip-path", "mask", "filter"].some((name) =>
        group.hasAttribute(name),
      ) ||
      (group.hasAttribute("opacity") &&
        Number(group.getAttribute("opacity")) !== 1) ||
      [...svg.querySelectorAll("[href]")].some(
        (node) => node.getAttribute("href") === `#${group.id}`,
      )
    )
      throw new Error(
        "This group has shared effects or references. Enter the group to edit its contents.",
      );
    const children = [...group.children].filter((child) =>
      child.matches(OBJECT_SELECTOR),
    );
    for (const child of children) {
      for (const attribute of [...group.attributes]) {
        if (
          ["id", "data-label", "data-for", "transform", "xmlns"].includes(
            attribute.name,
          )
        )
          continue;
        if (!child.hasAttribute(attribute.name))
          child.setAttribute(attribute.name, attribute.value);
      }
      const transform = [
        group.getAttribute("transform"),
        child.getAttribute("transform"),
      ]
        .filter(Boolean)
        .join(" ");
      if (transform) child.setAttribute("transform", transform);
      nextIds.push(child.id);
    }
    for (const dimension of svg.querySelectorAll("#dimensions > g[data-for]")) {
      const references = dimension
        .getAttribute("data-for")!
        .split(/\s+/)
        .flatMap((id) =>
          id === group.id ? children.map((child) => child.id) : [id],
        );
      dimension.setAttribute("data-for", [...new Set(references)].join(" "));
    }
    group.replaceWith(...children);
  }
  return { svg: cleanDrawing(serialize(svg)), ids: nextIds };
}

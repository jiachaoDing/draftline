import { describe, expect, it } from "vitest";
import { cleanDrawing, listElements, sanitizeSVG } from "../src/lib/drawing";
import {
  groupObjects,
  normalizeSelection,
  ungroupObjects,
} from "../src/lib/svg-selection";
import { drawingChanges } from "../src/lib/drawing-changes";
import { sourceSelectionContext } from "../src/lib/source-inspection";
import { OBJECT_SVG } from "./helpers/object-drawing";
import { EXAMPLE } from "../src/lib/example";
import { formatDrawingSource } from "../src/lib/format-source";
import { newProject, projectSchema } from "../src/lib/projects";

describe("SVG object hierarchy and editing scope", () => {
  it("restores review-pending replies as stopped without adding a drawing revision", () => {
    const project = newProject(EXAMPLE);
    project.messages.push({
      role: "assistant",
      text: "Proposed edit",
      status: "reviewing",
    });
    const restored = projectSchema.parse(project);
    expect(restored.messages.at(-1)?.status).toBe("cancelled");
    expect(restored.history.items).toHaveLength(1);
  });
  it("ignores source formatting when computing changed scope", async () => {
    const html = await formatDrawingSource(EXAMPLE.html);
    const svg = new DOMParser()
      .parseFromString(html, "text/html")
      .querySelector("svg")!;
    svg.querySelector("#hole-top-left")!.setAttribute("r", "7");
    expect(
      drawingChanges(EXAMPLE.svg, svg.outerHTML, ["hole-top-left"]).outsideIds,
    ).toEqual([]);
  });
  it("includes nested groups and text, normalizes parent/child overlaps and supplies source relationships", () => {
    const elements = listElements(sanitizeSVG(OBJECT_SVG));
    expect(elements.find((element) => element.id === "wordmark")).toMatchObject(
      { tag: "text", parentId: "nameplate" },
    );
    expect(elements.find((element) => element.id === "logo")?.childIds).toEqual(
      ["mark", "nameplate"],
    );
    expect(
      normalizeSelection(
        ["logo-left", "logo", "nearby", "nearby", "absent"],
        elements,
      ),
    ).toEqual(["logo", "nearby"]);
    const context = sourceSelectionContext(
      { path: "drawing.html", revision: "v1", html: OBJECT_SVG },
      ["logo-left"],
    );
    expect(
      context.objects.find((object) => object.id === "mark")?.parentId,
    ).toBe("logo");
    expect(
      context.objects.find((object) => object.id === "logo-size")?.related,
    ).toEqual(["logo-left", "logo-right"]);
  });

  it("groups adjacent siblings and ungroups while preserving transforms, styles, text and dimensional relationships", () => {
    const grouped = groupObjects(OBJECT_SVG, ["logo-left", "logo-right"]);
    const svg = sanitizeSVG(grouped.svg);
    expect(svg.querySelector(`#${grouped.ids[0]}`)?.children.length).toBe(2);
    expect(svg.querySelector("#logo-left")?.parentElement?.id).toBe(
      grouped.ids[0],
    );
    const ungrouped = ungroupObjects(grouped.svg, grouped.ids);
    expect(ungrouped.ids).toEqual(["logo-left", "logo-right"]);
    const flattened = ungroupObjects(OBJECT_SVG, ["mark"]);
    const next = sanitizeSVG(flattened.svg);
    expect(next.querySelector("#logo-left")?.getAttribute("transform")).toBe(
      "rotate(5)",
    );
    expect(next.querySelector("#logo-left")?.getAttribute("fill")).toBe(
      "#245ef0",
    );
    expect(next.querySelector("#wordmark")?.textContent).toBe("DraftLine");
    expect(next.querySelector("#logo-size")?.getAttribute("data-for")).toBe(
      "logo-left logo-right",
    );
    expect(next.querySelector("#nearby")?.outerHTML).toBe(
      sanitizeSVG(OBJECT_SVG).querySelector("#nearby")?.outerHTML,
    );
  });

  it("keeps shared effects intact and groups nonadjacent siblings at their topmost stacking position", () => {
    expect(() => groupObjects(OBJECT_SVG, ["logo-left", "nearby"])).toThrow(
      "same group",
    );
    expect(() =>
      ungroupObjects(
        OBJECT_SVG.replace('id="mark"', 'id="mark" opacity="0.5"'),
        ["mark"],
      ),
    ).toThrow("shared effects");
    const source = OBJECT_SVG.replace(
      '<path id="logo-right"',
      '<circle id="middle" r="1"/><path id="logo-right"',
    );
    const grouped = groupObjects(source, ["logo-left", "logo-right"]);
    const mark = sanitizeSVG(grouped.svg).querySelector("#mark")!;
    expect([...mark.children].map((child) => child.id)).toEqual([
      "middle",
      grouped.ids[0],
    ]);
    expect(
      [...mark.lastElementChild!.children].map((child) => child.id),
    ).toEqual(["logo-left", "logo-right"]);
  });

  it("assigns stable IDs to unnamed groups/text without flattening structure", () => {
    const source = OBJECT_SVG.replace('id="mark"', "").replace(
      'id="wordmark"',
      "",
    );
    const clean = cleanDrawing(source);
    const svg = sanitizeSVG(clean);
    expect(svg.querySelector("#logo > g")?.id).toMatch(/^object-g-/);
    expect(svg.querySelector("#nameplate > text")?.id).toMatch(/^object-text-/);
    expect(cleanDrawing(clean)).toBe(clean);
  });

  it("calculates actual broader changes independently from selection, including ancestor edits and moved objects", () => {
    const after = OBJECT_SVG.replace('width="12"', 'width="15"').replace(
      'width="40"',
      'width="50"',
    );
    expect(drawingChanges(OBJECT_SVG, after, ["logo"]).outsideIds).toEqual([
      "nearby",
    ]);
    expect(drawingChanges(OBJECT_SVG, after, ["logo-left"]).outsideIds).toEqual(
      ["nearby"],
    );
    expect(
      drawingChanges(
        OBJECT_SVG,
        OBJECT_SVG.replace("translate(15 20)", "translate(30 20)"),
        ["logo-left"],
      ).outsideIds,
    ).toContain("logo");
    expect(drawingChanges(OBJECT_SVG, after, []).outsideIds).toEqual([]);
    const add = OBJECT_SVG.replace(
      '</g>\n    <g id="nameplate"',
      '<circle id="new-dot" cx="4" cy="4" r="1"/></g>\n    <g id="nameplate"',
    );
    expect(drawingChanges(OBJECT_SVG, add, ["logo"]).outsideIds).toEqual([]);
  });
});

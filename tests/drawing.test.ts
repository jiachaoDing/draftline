import { describe, expect, it } from "vitest";
import {
  applyPatches,
  cleanDrawing,
  exportSVG,
  sanitizeSVG,
} from "../src/lib/drawing";
import { EXAMPLE_SVG } from "../src/lib/example";
import { pushHistory } from "../src/lib/history";

describe("millimeter vector drawing contract", () => {
  it("preserves physical dimensions and vector coordinates through export", () => {
    const result = exportSVG(EXAMPLE_SVG, true);
    const svg = new DOMParser().parseFromString(
      result,
      "image/svg+xml",
    ).documentElement;
    expect(svg.getAttribute("width")).toBe("164mm");
    expect(svg.getAttribute("height")).toBe("124mm");
    expect(svg.getAttribute("viewBox")).toBe("-22 -22 164 124");
    expect(svg.querySelector("#plate-outline")?.getAttribute("width")).toBe(
      "120",
    );
    expect(svg.querySelector("#dimensions")).not.toBeNull();
    expect(exportSVG(EXAMPLE_SVG, false)).not.toContain('id="dimensions"');
  });
  it("rejects mismatched physical scale and duplicate IDs", () => {
    expect(() => cleanDrawing(EXAMPLE_SVG.replace("164mm", "328mm"))).toThrow(
      "millimeter",
    );
    expect(() =>
      cleanDrawing(
        EXAMPLE_SVG.replace('id="hole-top-right"', 'id="hole-top-left"'),
      ),
    ).toThrow("unique");
  });
  it("strips executable content, external references, CSS and foreign objects", () => {
    const dirty = EXAMPLE_SVG.replace(
      "</svg>",
      '<script>alert(1)</script><foreignObject><iframe src="https://evil.example"/></foreignObject><image href="https://evil.example/leak"/><a href="javascript:alert(1)">link</a></svg>',
    ).replace(
      'cx="20"',
      'cx="20" onclick="alert(1)" style="fill:url(https://evil.example)"',
    );
    const clean = cleanDrawing(dirty);
    expect(clean).not.toMatch(
      /script|foreignObject|iframe|onclick|style=|evil\.example|javascript:/,
    );
  });
  it("patches the selected circle and preserves all unrelated geometry", () => {
    const result = applyPatches(
      EXAMPLE_SVG,
      [
        {
          id: "hole-top-left",
          svg: '<circle id="hole-top-left" data-label="Top left hole" cx="20" cy="20" r="7" />',
        },
      ],
      "hole-top-left",
    );
    const before = sanitizeSVG(EXAMPLE_SVG),
      after = sanitizeSVG(result);
    expect(after.querySelector("#hole-top-left")?.getAttribute("r")).toBe("7");
    for (const id of [
      "plate-outline",
      "hole-top-right",
      "hole-bottom-left",
      "hole-bottom-right",
    ])
      expect(after.querySelector(`#${id}`)?.outerHTML).toBe(
        before.querySelector(`#${id}`)?.outerHTML,
      );
  });
  it("rejects edits to unselected elements and accepts related annotations", () => {
    expect(() =>
      applyPatches(
        EXAMPLE_SVG,
        [{ id: "hole-top-right", svg: '<circle id="hole-top-right" r="7" />' }],
        "hole-top-left",
      ),
    ).toThrow("unrelated");
    expect(() =>
      applyPatches(
        EXAMPLE_SVG,
        [
          {
            id: "dim-height",
            svg: '<g id="dim-height" data-for="plate-outline"><text>90</text></g>',
          },
        ],
        "hole-top-left",
      ),
    ).toThrow("unrelated");
    expect(
      applyPatches(
        EXAMPLE_SVG,
        [
          {
            id: "dim-hole",
            svg: '<g id="dim-hole" data-for="hole-top-left"><text>Ø14</text></g>',
          },
        ],
        "hole-top-left",
      ),
    ).toContain("Ø14");
  });
  it("rejects identity changes and retains a bounded branching undo history", () => {
    expect(() =>
      applyPatches(
        EXAMPLE_SVG,
        [{ id: "hole-top-left", svg: '<circle id="renamed" r="7" />' }],
        "hole-top-left",
      ),
    ).toThrow("IDs");
    expect(pushHistory({ items: ["a", "b", "c"], index: 0 }, "d")).toEqual({
      items: ["a", "d"],
      index: 1,
    });
    let history = { items: [0], index: 0 };
    for (let i = 1; i < 100; i++) history = pushHistory(history, i);
    expect(history.items).toHaveLength(30);
    expect(history.items[history.index]).toBe(99);
  });
});

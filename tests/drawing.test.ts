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
    const result = exportSVG(EXAMPLE_SVG);
    const svg = new DOMParser().parseFromString(
      result,
      "image/svg+xml",
    ).documentElement;
    expect(svg.getAttribute("width")).toBe("338mm");
    expect(svg.getAttribute("height")).toBe("124mm");
    expect(svg.getAttribute("viewBox")).toBe("-22 -22 338 124");
    const [left, right] = [...svg.children];
    expect(left.getAttribute("x")).toBe("-22");
    expect(right.getAttribute("x")).toBe("152");
    for (const panel of [left, right]) {
      expect(panel.getAttribute("viewBox")).toBe("-22 -22 164 124");
      expect(panel.querySelector("rect")?.getAttribute("width")).toBe("120");
    }
    expect(left.querySelector('[data-layer="dimensions"]')).toBeNull();
    expect(right.querySelector('[data-layer="dimensions"]')).not.toBeNull();
    expect(svg.querySelector('[data-layer="presentation"]')).toBeNull();
    const ids = [...svg.querySelectorAll("[id]")].map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(cleanDrawing(EXAMPLE_SVG)).toContain('id="dimensions"');
  });
  it("keeps fragment references within each copy without duplicating inherited opacity", () => {
    const source = EXAMPLE_SVG.replace(
      'id="drawing"',
      'id="drawing" opacity="0.5"',
    )
      .replace(
        "<defs>",
        '<defs><linearGradient id="ink"><stop offset="0" stop-color="red"/></linearGradient><clipPath id="cut"><rect width="120" height="80"/></clipPath>',
      )
      .replace('id="plate-outline"', 'id="annotated-plate-outline"')
      .replaceAll(
        'data-for="plate-outline"',
        'data-for="annotated-plate-outline"',
      )
      .replace(
        '</g>\n<g id="dimensions"',
        '<use id="repeat" href="#annotated-plate-outline" fill="url(#ink)" clip-path="url(#cut)"/></g>\n<g id="dimensions"',
      );
    const svg = new DOMParser().parseFromString(
      exportSVG(source),
      "image/svg+xml",
    ).documentElement;
    expect(svg.hasAttribute("opacity")).toBe(false);
    for (const panel of [...svg.children]) {
      expect(panel.getAttribute("opacity")).toBe("0.5");
      for (const node of panel.querySelectorAll("*")) {
        for (const attr of [...node.attributes]) {
          const id = attr.value.match(/^#([\w.-]+)$|^url\(#([\w.-]+)\)$/);
          if (id && (attr.name === "href" || attr.value.startsWith("url("))) {
            expect(
              panel.querySelector(`[id="${id[1] || id[2]}"]`),
            ).not.toBeNull();
          }
        }
      }
    }
    const ids = [...svg.querySelectorAll("[id]")].map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(svg.querySelectorAll("use")).toHaveLength(2);
  });
  it("exports an empty dimensions group and rejects invalid input", () => {
    const source = EXAMPLE_SVG.replace(
      /<g id="dimensions"[\s\S]*<\/g><\/svg>/,
      '<g id="dimensions" data-layer="dimensions"/></svg>',
    );
    expect(exportSVG(source)).toContain('id="annotated-dimensions"');
    expect(() => exportSVG(EXAMPLE_SVG.replace("164mm", "328mm"))).toThrow(
      "millimeter",
    );
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
    const result = applyPatches(EXAMPLE_SVG, [
      {
        id: "hole-top-left",
        svg: '<circle id="hole-top-left" data-label="Top left hole" cx="20" cy="20" r="7" />',
      },
    ]);
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
  it("accepts coherent object replacements independently from selection context", () => {
    expect(
      applyPatches(EXAMPLE_SVG, [
        { id: "hole-top-right", svg: '<circle id="hole-top-right" r="7" />' },
      ]),
    ).toContain('id="hole-top-right" r="7"');
    expect(
      applyPatches(EXAMPLE_SVG, [
        {
          id: "dim-height",
          svg: '<g id="dim-height" data-for="plate-outline"><text>90</text></g>',
        },
      ]),
    ).toContain('id="dim-height"');
    expect(
      applyPatches(EXAMPLE_SVG, [
        {
          id: "dim-hole",
          svg: '<g id="dim-hole" data-for="hole-top-left"><text>Ø14</text></g>',
        },
      ]),
    ).toContain("Ø14");
  });
  it("rejects identity changes and retains a bounded branching undo history", () => {
    expect(() =>
      applyPatches(EXAMPLE_SVG, [
        { id: "hole-top-left", svg: '<circle id="renamed" r="7" />' },
      ]),
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

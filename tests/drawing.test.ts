import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  applyPatches,
  cleanDrawing,
  exportSVG,
  sanitizeSVG,
} from "../src/lib/drawing";
import { EXAMPLE_SVG } from "../src/lib/example";
import { pushHistory } from "../src/lib/history";
import { addPresentation } from "../src/lib/presentation";

// Unit tests use deterministic font metrics; browser tests exercise actual Arial measurements.
beforeAll(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    font: "",
    measureText(this: { font: string }, text: string) {
      return {
        width: [...text].length * parseFloat(this.font.split(" ")[1]) * 0.55,
      };
    },
  } as unknown as CanvasRenderingContext2D);
});

describe("millimeter vector drawing contract", () => {
  it("preserves physical dimensions and vector coordinates through export", () => {
    const result = exportSVG(EXAMPLE_SVG, true);
    const svg = new DOMParser().parseFromString(
      result,
      "image/svg+xml",
    ).documentElement;
    expect(svg.getAttribute("width")).toBe("164mm");
    expect(
      Number(svg.getAttribute("height")!.replace("mm", "")),
    ).toBeGreaterThan(124);
    expect(svg.getAttribute("viewBox")!.split(" ").slice(0, 3)).toEqual([
      "-22",
      "-22",
      "164",
    ]);
    expect(svg.querySelector("#plate-outline")?.getAttribute("width")).toBe(
      "120",
    );
    expect(svg.querySelector("#dimensions")).not.toBeNull();
    expect(
      svg.querySelector('#presentation [data-field="title"]')?.textContent,
    ).toBe("Mounting plate");
    expect(
      svg.querySelector('#presentation [data-field="scale"]')?.textContent,
    ).toBe("1:1");
    expect(exportSVG(EXAMPLE_SVG, false)).not.toContain('id="dimensions"');
    expect(exportSVG(EXAMPLE_SVG, false)).not.toContain('id="presentation"');
    expect(exportSVG(EXAMPLE_SVG, false)).toContain(
      'viewBox="-22 -22 164 124"',
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
  it("keeps presentation outside geometry and restores canonical bounds without accumulating footers", () => {
    const before = sanitizeSVG(EXAMPLE_SVG);
    const sheet = addPresentation(sanitizeSVG(EXAMPLE_SVG), {
      title: "Plate <A> & B",
      notes: ["Material: user-specified aluminum."],
    });
    expect(sheet.querySelector("#geometry")!.outerHTML).toBe(
      before.querySelector("#geometry")!.outerHTML,
    );
    expect(sheet.querySelector("#dimensions")!.outerHTML).toBe(
      before.querySelector("#dimensions")!.outerHTML,
    );
    expect(sheet.querySelector("#presentation")!.parentElement).toBe(sheet);
    expect(sheet.querySelector("#presentation")!.textContent).toContain(
      "Plate <A> & B",
    );
    expect(sheet.querySelector("#presentation")!.textContent).not.toMatch(
      /tolerance|finish|revision|deburr/i,
    );
    const height = sheet.getAttribute("height");
    addPresentation(sheet, {
      title: "Plate <A> & B",
      notes: ["Material: user-specified aluminum."],
    });
    expect(sheet.querySelectorAll("#presentation")).toHaveLength(1);
    expect(sheet.getAttribute("height")).toBe(height);
    const restored = cleanDrawing(new XMLSerializer().serializeToString(sheet));
    expect(restored).not.toContain('id="presentation"');
    expect(restored).toContain('viewBox="-22 -22 164 124"');
  });
  it("expands narrow sheets and wraps long titles and Unicode notes below the drawing", () => {
    const source =
      '<svg id="drawing" xmlns="http://www.w3.org/2000/svg" width="36mm" height="26mm" viewBox="0 0 36 26"><g id="geometry" data-layer="geometry"><rect id="spacer-outline" x="8" y="8" width="20" height="10" /></g><g id="dimensions" data-layer="dimensions" /></svg>';
    const title =
      "A very long precision mounting component title that must wrap without truncation";
    const note =
      "表面处理：仅按用户提供的技术要求执行，不添加额外材料或工艺要求。";
    const svg = addPresentation(sanitizeSVG(source), { title, notes: [note] });
    expect(svg.getAttribute("width")).toBe("120mm");
    expect(svg.querySelector("#spacer-outline")!.getAttribute("width")).toBe(
      "20",
    );
    const titleLines = [...svg.querySelectorAll('[data-field="title"]')];
    expect(titleLines.length).toBeGreaterThan(1);
    expect(
      titleLines
        .map((n) => n.textContent)
        .join(" ")
        .replace(/\s/g, ""),
    ).toBe(title.replace(/\s/g, ""));
    expect(
      [...svg.querySelectorAll('[data-field="note"]')]
        .map((n) => n.textContent)
        .join(""),
    ).toContain(note);
    const box = svg.getAttribute("viewBox")!.split(" ").map(Number);
    for (const text of svg.querySelectorAll("#presentation text")) {
      expect(Number(text.getAttribute("y"))).toBeGreaterThan(26);
      expect(Number(text.getAttribute("y"))).toBeLessThan(box[1] + box[3] - 5);
    }
  });
});

import { describe, expect, it } from "vitest";
import { formatDrawingSource } from "../src/lib/format-source";
import { cleanDrawing } from "../src/lib/drawing";
import { EXAMPLE_SVG } from "../src/lib/example";

describe("drawing source formatting", () => {
  it("formats HTML, SVG, inline JavaScript and CSS without changing drawing data", async () => {
    const source = `<!doctype html><html><head><style>svg{color:red;stroke-width:0.4}</style></head><body>${EXAMPLE_SVG}<script>const hole=document.getElementById('hole-top-left');hole.setAttribute('r','6');</script></body></html>`;
    const formatted = await formatDrawingSource(source);
    expect(formatted).toContain("\n<html>\n  <head>\n");
    expect(formatted).toContain("\n      svg {\n");
    expect(formatted).toContain(
      '\n      const hole = document.getElementById("hole-top-left");',
    );
    expect(formatted).toContain('viewBox="-22 -22 164 124"');
    expect(formatted).toContain("4 × Ø10");
    const svg = new DOMParser()
      .parseFromString(formatted, "text/html")
      .querySelector("svg")!;
    expect(cleanDrawing(svg.outerHTML)).toBeTruthy();
    expect(svg.querySelector("#hole-top-left")?.getAttribute("r")).toBe("5");
    expect(svg.getAttribute("width")).toBe("164mm");
    expect(await formatDrawingSource(formatted)).toBe(formatted);
  });

  it("preserves rendered spacing between SVG text spans", async () => {
    const source =
      "<svg><text><tspan>Ø10</tspan> <tspan>mm</tspan></text></svg>";
    const formatted = await formatDrawingSource(source);
    const parse = (value: string) =>
      new DOMParser()
        .parseFromString(value, "text/html")
        .querySelector("text")!
        .textContent!.replace(/\s+/g, " ")
        .trim();
    expect(parse(formatted)).toBe(parse(source));
  });

  it("rejects malformed HTML so an editor can retain the original draft", async () => {
    await expect(formatDrawingSource("<svg><g></svg>")).rejects.toThrow();
  });
});

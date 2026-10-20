import type { Page } from "@playwright/test";
import { test, expect } from "../helpers/workspace-test";

const plate = `<svg xmlns="http://www.w3.org/2000/svg" id="drawing" width="100mm" height="60mm" viewBox="0 0 100 60"><g id="geometry" data-layer="geometry"><rect id="plate" width="100" height="60" rx="5" fill="none" stroke="black"/></g><g id="dimensions" data-layer="dimensions"><g id="dim" data-for="plate"><text x="50" y="59">100 × 60 R5</text></g></g></svg>`;
const svg = (children: string, attributes = 'viewBox="0 0 1000 800"') =>
  `<svg xmlns="http://www.w3.org/2000/svg" ${attributes}>${children}</svg>`;
const mark = '<path id="art" d="M310 120h20v10h-20Z"/>';

async function place(
  page: Page,
  source: string,
  args: Record<string, unknown> = {},
  parentTransform = "",
) {
  return page.evaluate(
    async ({ source, args, plate, parentTransform }) => {
      const path = "/src/lib/";
      const { DrawingToolSession } = await import(
        `${path}drawing-tool-session.ts`
      );
      const { validateDrawingSource } = await import(
        `${path}validate-source.ts`
      );
      const { cleanDrawing, svgToHTML } = await import(`${path}drawing.ts`);
      const original = cleanDrawing(
        plate.replace(
          'id="geometry"',
          `id="geometry" transform="${parentTransform}"`,
        ),
      );
      const drawing = {
        title: "Plate",
        summary: "Plate",
        svg: original,
        html: svgToHTML(original),
      };
      const resource = {
        id: "logo",
        name: "logo.svg",
        type: "svg",
        size: source.length,
        text: source,
      };
      const session = new DrawingToolSession(
        { path: "drawing.html", revision: "base", html: drawing.html },
        drawing,
        validateDrawingSource,
        () => true,
        () => resource,
      );
      const output = JSON.parse(
        await session.execute(
          {
            id: "place",
            name: "place_svg",
            arguments: JSON.stringify({
              resource_id: "logo",
              object_id: "brand",
              revision: "base",
              x: 50,
              y: 30,
              width: 40,
              bounds: "content",
              anchor: "center",
              fit_box: { x: 0, y: 0, width: 100, height: 60 },
              ...args,
            }),
          },
          new AbortController().signal,
        ),
      );
      const container = document.createElement("div");
      container.innerHTML = session.drawing.svg;
      document.body.append(container);
      const root = container.querySelector<SVGSVGElement>("svg")!;
      const originalContainer = document.createElement("div");
      originalContainer.innerHTML = original;
      const dimensionsUnchanged = root
        .querySelector("#dimensions")!
        .isEqualNode(originalContainer.querySelector("#dimensions"));
      const plateUnchanged = root
        .querySelector("#plate")!
        .isEqualNode(originalContainer.querySelector("#plate"));
      root.querySelector("#plate")!.remove();
      root.querySelector("#dimensions")!.remove();
      let vector;
      let pixels;
      if (output.ok) {
        const rect = root
          .querySelector<SVGGraphicsElement>("#brand")!
          .getBoundingClientRect();
        const inverse = root.getScreenCTM()!.inverse();
        const start = new DOMPoint(rect.x, rect.y).matrixTransform(inverse);
        const end = new DOMPoint(rect.right, rect.bottom).matrixTransform(
          inverse,
        );
        vector = {
          x: start.x,
          y: start.y,
          width: end.x - start.x,
          height: end.y - start.y,
        };
        root.setAttribute("width", "1000px");
        root.setAttribute("height", "600px");
        const image = new Image();
        image.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(new XMLSerializer().serializeToString(root))))}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = 1000;
        canvas.height = 600;
        const context = canvas.getContext("2d")!;
        context.drawImage(image, 0, 0);
        const data = context.getImageData(0, 0, 1000, 600).data;
        let left = 1000,
          top = 600,
          right = -1,
          bottom = -1;
        for (let row = 0; row < 600; row++)
          for (let column = 0; column < 1000; column++)
            if (data[(row * 1000 + column) * 4 + 3] > 16) {
              left = Math.min(left, column);
              right = Math.max(right, column);
              top = Math.min(top, row);
              bottom = Math.max(bottom, row);
            }
        pixels = {
          width: (right - left + 1) / 10,
          height: (bottom - top + 1) / 10,
          centerX: (left + right + 1) / 20,
          centerY: (top + bottom + 1) / 20,
        };
      }
      container.remove();
      return {
        output,
        vector,
        pixels,
        plateUnchanged,
        dimensionsUnchanged,
        unchanged: session.drawing.svg === original,
        source: session.drawing.svg,
      };
    },
    { source, args, plate, parentTransform },
  );
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("small off-center artwork is 40 mm wide and centered on a 100 × 60 R5 plate", async ({
  page,
}) => {
  const result = await place(page, svg(mark));
  expect(result.output.ok, result.output.error).toBe(true);
  expect(result.vector!.width).toBeCloseTo(40, 4);
  expect(result.vector!.height).toBeCloseTo(20, 4);
  expect(result.vector!.x).toBeCloseTo(30, 4);
  expect(result.vector!.y).toBeCloseTo(20, 4);
  expect(result.pixels).toEqual({
    width: 40,
    height: 20,
    centerX: 50,
    centerY: 30,
  });
  expect(result.plateUnchanged && result.dimensionsUnchanged).toBe(true);
  expect(result.source).toContain('d="M310 120h20v10h-20Z"');
});

test("native measurement composes nonzero viewBoxes, nested SVGs, resource transforms and drawing parents", async ({
  page,
}) => {
  const result = await place(
    page,
    svg(
      `<g transform="translate(50 70) scale(2)"><svg x="100" y="50" width="200" height="100" viewBox="10 20 100 50"><g transform="translate(3 4) rotate(90 30 30)"><path d="M20 20h10v20h-10Z"/></g></svg></g>`,
      'width="2000" height="2000" viewBox="-100 -200 2000 2000"',
    ),
    {},
    "translate(12 8) rotate(20) scale(1.5 2)",
  );
  expect(result.output.ok, result.output.error).toBe(true);
  expect(result.pixels!.width).toBeCloseTo(40, 1);
  expect(result.pixels!.height).toBeCloseTo(20, 1);
  expect(result.pixels!.centerX).toBeCloseTo(50, 1);
  expect(result.pixels!.centerY).toBeCloseTo(30, 1);
});

test("defs and hidden artwork do not count; supported strokes and enclosing clips include the painted extent", async ({
  page,
}) => {
  const source = svg(
    `<defs><path d="M0 0h10000v10000Z"/><linearGradient id="paint"><stop stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient><clipPath id="clip"><rect x="100" y="100" width="600" height="400"/></clipPath></defs><path display="none" d="M0 0h900v700Z"/><g opacity="0"><rect width="1000" height="800"/></g><g visibility="hidden"><rect width="900" height="700"/><rect visibility="visible" x="310" y="120" width="20" height="10" fill="url(#paint)" stroke="black" stroke-width="2" clip-path="url(#clip)"/></g>`,
  );
  const result = await place(page, source);
  expect(result.output.ok, result.output.error).toBe(true);
  expect(result.pixels!.width).toBeCloseTo(40, 1);
  expect(result.pixels!.height).toBeCloseTo((40 * 12) / 22, 0);
  expect(result.pixels!.centerX).toBeCloseTo(50, 1);
  expect(result.pixels!.centerY).toBeCloseTo(30, 1);
  expect(result.source).toContain("linearGradient");
  expect(result.source).toContain("clip-path=");
});

test("multiple filled paths with arbitrary nested rotation use native content bounds", async ({
  page,
}) => {
  const result = await place(
    page,
    svg(
      `<g transform="translate(30 40) rotate(23 320 125)">${mark}<path d="M340 120h10v10h-10Z"/></g>`,
    ),
  );
  expect(result.output.ok, result.output.error).toBe(true);
  expect(result.pixels!.width).toBeCloseTo(40, 0);
  expect(result.pixels!.centerX).toBeCloseTo(50, 0);
  expect(result.pixels!.centerY).toBeCloseTo(30, 0);
});

test("canvas mode retains asymmetric whitespace and origin placement semantics", async ({
  page,
}) => {
  const centered = await place(page, svg(mark), { bounds: "canvas" });
  expect(centered.output.ok, centered.output.error).toBe(true);
  expect(centered.pixels!.width).toBeCloseTo(0.8, 1);
  expect(centered.pixels!.centerX).toBeCloseTo(42.8, 1);
  const legacy = await place(page, svg(mark), {
    bounds: "canvas",
    anchor: null,
    x: 0,
    y: 0,
  });
  expect(legacy.output.ok, legacy.output.error).toBe(true);
  expect(legacy.pixels!.centerX).toBeCloseTo(12.8, 1);
});

test("a canvas background requires explicit artwork selection without changing the stored resource", async ({
  page,
}) => {
  const source = svg(
    `<rect id="background" width="1000" height="800" fill="white"/>${mark}`,
  );
  const ambiguous = await place(page, source);
  expect(ambiguous.output.ok).toBe(false);
  expect(ambiguous.output.error).toContain("background");
  expect(ambiguous.unchanged).toBe(true);
  const selected = await place(page, source, { target_id: "art" });
  expect(selected.output.ok, selected.output.error).toBe(true);
  expect(selected.pixels).toEqual({
    width: 40,
    height: 20,
    centerX: 50,
    centerY: 30,
  });
  expect(selected.source).toContain('fill="white" display="none"');
});

for (const [name, source] of [
  [
    "slice viewport",
    svg(
      mark,
      'width="100" height="100" viewBox="0 0 1000 800" preserveAspectRatio="xMidYMid slice"',
    ),
  ],
  [
    "transparent artwork",
    svg('<rect x="310" y="120" width="20" height="10" fill="transparent"/>'),
  ],
  [
    "transparent gradient",
    svg(
      `<defs><linearGradient id="paint"><stop stop-opacity="0"/><stop offset="1" stop-opacity="0"/></linearGradient></defs><path fill="url(#paint)" d="M310 120h20v10h-20Z"/>`,
    ),
  ],
  [
    "empty artwork",
    svg(
      '<defs><rect width="1000" height="800"/></defs><path display="none" d="M0 0h20v10Z"/>',
    ),
  ],
  ["zero-area artwork", svg('<path d="M10 20"/>')],
  [
    "intersecting clip",
    svg(
      `<defs><clipPath id="clip"><rect x="310" y="120" width="5" height="5"/></clipPath></defs><g clip-path="url(#clip)">${mark}</g>`,
    ),
  ],
  [
    "mask",
    svg(
      `<defs><mask id="mask"><rect width="1000" height="800" fill="white"/></mask></defs><g mask="url(#mask)">${mark}</g>`,
    ),
  ],
  [
    "filter",
    svg(
      `<defs><filter id="filter"><feGaussianBlur stdDeviation="3"/></filter></defs><g filter="url(#filter)">${mark}</g>`,
    ),
  ],
  [
    "unsupported path stroke",
    svg('<path d="M310 120h20v10Z" stroke="black" stroke-width="2"/>'),
  ],
  [
    "viewport clipping",
    svg(
      '<svg width="10" height="10" viewBox="0 0 10 10"><rect width="20" height="20"/></svg>',
    ),
  ],
  ["oversized artwork", svg('<rect x="310" y="120" width="10" height="100"/>')],
]) {
  test(`${name} fails atomically without a smaller fallback`, async ({
    page,
  }) => {
    const result = await place(page, source);
    expect(result.output.ok, JSON.stringify(result)).toBe(false);
    expect(result.output.error).toMatch(/measurement|does not fit/);
    expect(result.unchanged).toBe(true);
  });
}

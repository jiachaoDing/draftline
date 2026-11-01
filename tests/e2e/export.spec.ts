import { installDrawingFixture } from "../helpers/project-storage";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import {
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFDict,
  PDFArray,
  PDFString,
} from "pdf-lib";
import { test, expect } from "../helpers/workspace-test";
import { EXAMPLE_SVG } from "../../src/lib/example";
import { waitForProjectSave } from "../helpers/project-storage";

test("bundled fonts keep Unicode labels as text with named PDF layers", async ({
  page,
}) => {
  await page.goto("/");
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  const result = await page.evaluate(async () => {
    const exportPath = "/src/lib/pdf-export.ts";
    const resourcePath = "/src/lib/pdf-resource.ts";
    const { exportPDF } = await import(exportPath);
    const { inspectPdf } = await import(resourcePath);
    const source = `<svg id="drawing" xmlns="http://www.w3.org/2000/svg" width="100mm" height="60mm" viewBox="0 0 100 60">
      <g id="geometry" data-layer="geometry" font-family="sans-serif" font-size="6" fill="#26364a">
        <text id="unicode" x="45" y="12" text-anchor="middle">中文口 Ø10 ±0.1</text>
        <text id="bold-label" x="10" y="25" font-weight="bold" transform="rotate(12 10 25)"><tspan fill="#c02020">红色</tspan><tspan fill="#2020c0" dy="7">蓝色</tspan></text>
      </g><g id="dimensions" data-layer="dimensions"/></svg>`;
    const stages: string[] = [];
    const bytes = await exportPDF(source, (stage: string) =>
      stages.push(stage),
    );
    const file = `data:application/pdf;base64,${btoa(String.fromCharCode(...bytes))}`;
    const text = await inspectPdf(
      file,
      1,
      "text",
      new AbortController().signal,
    );
    return {
      stages,
      text: text.text,
      bytes: [...bytes],
      temporaryHosts: document.querySelectorAll('[aria-hidden="true"] > svg')
        .length,
    };
  });
  expect(result.text?.replace(/\s/g, "")).toContain("中文口Ø10±0.1");
  expect(result.text?.replace(/\s/g, "")).toContain("红色蓝色");
  expect(result.temporaryHosts).toBe(0);
  expect(result.stages).toEqual(["Preparing fonts…", "Generating PDF…"]);
  expect(
    requests.every((url) => new URL(url).origin === new URL(page.url()).origin),
  ).toBe(true);
  const pdf = await PDFDocument.load(new Uint8Array(result.bytes));
  const properties = pdf.catalog.lookup(PDFName.of("OCProperties"), PDFDict);
  const groups = properties.lookup(PDFName.of("OCGs"), PDFArray);
  expect(
    groups
      .asArray()
      .map((ref) =>
        pdf.context
          .lookup(ref, PDFDict)
          .lookup(PDFName.of("Name"), PDFString)
          .decodeText(),
      ),
  ).toEqual(["geometry", "annotated-geometry", "annotated-dimensions"]);
  const streams = pdf.context
    .enumerateIndirectObjects()
    .map(([, object]) => object)
    .filter((object): object is PDFRawStream => object instanceof PDFRawStream);
  expect(
    streams.some(
      (stream) =>
        stream.dict.get(PDFName.of("Subtype")) === PDFName.of("Image"),
    ),
  ).toBe(false);
  expect(
    streams.filter(
      (stream) => stream.dict.get(PDFName.of("Subtype")) === PDFName.of("Form"),
    ).length,
  ).toBeLessThan(10);
});

test("dimension toggle persists and PDF exports both views at actual size with Unicode labels", async ({
  page,
}) => {
  await page.goto("/");
  const frame = page.frameLocator('iframe[title="Technical drawing preview"]');
  await expect(frame.locator("#plate-outline")).toBeVisible();
  await installDrawingFixture(
    page,
    EXAMPLE_SVG.replace(
      '</g>\n<g id="dimensions"',
      '<text id="unicode-label" x="40" y="40" font-size="4" fill="#26364a" stroke="none">中文 Ø10 ±0.1</text></g>\n<g id="dimensions"',
    ),
  );
  await expect(frame.locator("#unicode-label")).toBeVisible();
  const toggle = page.getByRole("button", { name: "Dimensions", exact: true });
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await toggle.click();
  await expect(frame.locator("#dimensions")).toHaveAttribute("display", "none");
  await expect(frame.locator("#plate-outline")).toBeVisible();
  await waitForProjectSave(page);
  await page.reload();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(frame.locator("#dimensions")).toHaveAttribute("display", "none");
  await expect(frame.locator("#plate-outline")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Drawing layers" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Export PDF" }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toMatch(/\.pdf$/);
  const bytes = await readFile((await download.path())!);
  const pdf = await PDFDocument.load(bytes);
  const streams = pdf.context
    .enumerateIndirectObjects()
    .map(([, object]) => object)
    .filter((object): object is PDFRawStream => object instanceof PDFRawStream);
  expect(
    streams.some(
      (stream) =>
        stream.dict.get(PDFName.of("Subtype")) === PDFName.of("Image"),
    ),
  ).toBe(false);
  // Arrowheads and geometry are vector Form XObjects, rather than page screenshots.
  expect(
    streams.some(
      (stream) => stream.dict.get(PDFName.of("Subtype")) === PDFName.of("Form"),
    ),
  ).toBe(true);
  expect(pdf.getPageCount()).toBe(1);
  const size = pdf.getPage(0).getSize();
  expect(size.width).toBeCloseTo((338 * 72) / 25.4, 5);
  expect(size.height).toBeCloseTo((124 * 72) / 25.4, 5);
  const preview = await page.evaluate(
    async (file) => {
      const modulePath = "/src/lib/pdf-resource.ts";
      const { inspectPdf } = await import(modulePath);
      return inspectPdf(file, 1, "preview", new AbortController().signal);
    },
    `data:application/pdf;base64,${bytes.toString("base64")}`,
  );
  await mkdir(".generated", { recursive: true });
  await writeFile(".generated/export-test.pdf", bytes);
  await writeFile(
    ".generated/pdf-export-preview.webp",
    Buffer.from(preview.image.split(",")[1], "base64"),
  );
  const ink = await page.evaluate(async (url) => {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(image, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const counts = [0, 0];
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        const offset = (y * canvas.width + x) * 4;
        if (
          data[offset] < 200 &&
          data[offset + 1] < 200 &&
          data[offset + 2] < 200
        ) {
          counts[x < canvas.width / 2 ? 0 : 1]++;
        }
      }
    }
    return counts;
  }, preview.image);
  expect(ink[0]).toBeGreaterThan(1000);
  expect(ink[1]).toBeGreaterThan(ink[0]);
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await expect(frame.locator("#dimensions")).toHaveAttribute(
    "display",
    "inline",
  );
});

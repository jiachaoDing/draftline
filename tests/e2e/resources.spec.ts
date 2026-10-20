import { createServer, type Server, type ServerResponse } from "node:http";
import type { Page } from "@playwright/test";
import { test, expect } from "../helpers/workspace-test";
import { attachFiles } from "../helpers/attach-files";
import { completeResponse, toolResponse } from "../helpers/provider-stream";
import { waitForProjectSave } from "../helpers/project-storage";
import { EXAMPLE_SVG } from "../../src/lib/example";

let provider: Server;
let baseURL: string;
let requests: any[] = [];
let resourceId = "";
let release = () => {};
let completionAttempts = 0;
const tool = (res: ServerResponse, id: string, name: string, args: unknown) =>
  toolResponse(res, [{ id, name, arguments: JSON.stringify(args) }]);
const done = (res: ServerResponse, message: string) =>
  completeResponse(res, JSON.stringify({ kind: "message", message }));

test.beforeAll(async () => {
  provider = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const input = JSON.parse(body);
    requests.push(input);
    const user = input.messages.findLast(
      (m: any) =>
        m.role === "user" &&
        Array.isArray(m.content) &&
        !m.content[0].text.startsWith("Requested preview"),
    );
    const instruction: string = user.content[0].text;
    const catalog = user.content.find((part: any) =>
      part.text?.startsWith("Project resource catalog"),
    );
    const resources = catalog
      ? JSON.parse(catalog.text.slice(catalog.text.indexOf("\n") + 1))
      : [];
    if (resources.length) resourceId = resources[0].id;
    const last = input.messages.findLast((m: any) => m.role === "tool");
    const result = last ? JSON.parse(last.content) : undefined;
    const revision = instruction.match(/Revision: ([^\n]+)/)?.[1];
    if (instruction.includes("center measured logo")) {
      if (!last)
        tool(res, "place-measured", "place_svg", {
          resource_id: resourceId,
          object_id: "brand",
          revision,
          bounds: "content",
          anchor: "center",
          x: 50,
          y: 30,
          width: 40,
          fit_box: { x: 0, y: 0, width: 100, height: 60 },
        });
      else if (++completionAttempts === 1) {
        await new Promise<void>((resolve) => {
          release = resolve;
          res.once("close", resolve);
        });
        if (!res.destroyed) completeResponse(res, "The logo is complete.");
      } else
        tool(res, "finish-measured", "finish_drawing", {
          revision: result.revision,
          summary: "Measured logo centered.",
        });
    } else if (instruction.includes("place original logo")) {
      if (!last)
        tool(res, "inspect", "inspect_resource", {
          resource_id: resourceId,
          preview: true,
        });
      else if (last.tool_call_id === "inspect")
        tool(res, "place", "place_svg", {
          bounds: "canvas",
          resource_id: resourceId,
          object_id: "brand",
          revision,
          x: 90,
          y: 5,
          width: 20,
        });
      else if (last.tool_call_id === "place")
        tool(res, "transform", "transform_object", {
          object_id: "brand",
          revision: result.revision,
          x: 1,
          y: 2,
          scale: 0.5,
          rotation: 10,
        });
      else {
        if (
          instruction.includes("recover completion") &&
          ++completionAttempts > 1
        ) {
          tool(res, "finish", "finish_drawing", {
            revision: result.revision,
            summary: "Original logo placed.",
          });
          return;
        }
        await new Promise<void>((resolve) => {
          release = resolve;
          res.once("close", resolve);
        });
        if (!res.destroyed) {
          if (instruction.includes("recover completion"))
            completeResponse(res, "The logo placement is complete.");
          else done(res, "Original logo placed.");
        }
      }
    } else if (instruction.includes("reuse stored reference")) {
      if (!last) tool(res, "list", "list_resources", {});
      else if (last.tool_call_id === "list")
        tool(res, "read", "read_resource", {
          resource_id: resourceId,
          query: "<path",
          limit: 120,
        });
      else done(res, "Stored reference is available.");
    } else if (instruction.includes("access other project")) {
      if (!last)
        tool(res, "denied", "read_resource", { resource_id: resourceId });
      else
        done(res, result.ok ? "Unexpected access." : "Resource access denied.");
    } else if (instruction.includes("inspect PDF page")) {
      if (!last)
        tool(res, "pdf-preview", "inspect_resource", {
          resource_id: resourceId,
          preview: true,
          page: 2,
        });
      else if (last.tool_call_id === "pdf-preview")
        tool(res, "pdf-text", "read_resource", {
          resource_id: resourceId,
          page: 1,
          limit: 100,
        });
      else done(res, "Selected PDF page inspected.");
    } else if (instruction.includes("inspect DXF geometry")) {
      if (!last)
        tool(res, "dxf-preview", "inspect_resource", {
          resource_id: resourceId,
          preview: true,
        });
      else done(res, "DXF geometry inspected.");
    } else done(res, "Reference stored.");
  });
  await new Promise<void>((resolve) =>
    provider.listen(0, "127.0.0.1", resolve),
  );
  baseURL = `http://127.0.0.1:${(provider.address() as { port: number }).port}/v1`;
});
test.beforeEach(async ({ page }) => {
  requests = [];
  completionAttempts = 0;
  await page.addInitScript((baseURL) => {
    if (window === window.top)
      localStorage.setItem(
        "draftline-model",
        JSON.stringify({
          baseURL,
          apiKey: "resource-test",
          model: "resource-model",
        }),
      );
  }, baseURL);
  await page.goto("/");
});
test.afterEach(() => release());
test.afterAll(
  () => new Promise<void>((resolve) => provider.close(() => resolve())),
);

test("large SVG previews and intact placement stay staged, survive undo/reload and remain scoped to the project", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Code", exact: true }).click();
  await page
    .getByLabel("Drawing source code")
    .fill(
      EXAMPLE_SVG.replace(
        'id="geometry"',
        'id="geometry" transform="translate(20 15) scale(2)"',
      ),
    );
  await page.getByRole("button", { name: "Apply code", exact: true }).click();
  await expect(
    page
      .frameLocator('iframe[title="Technical drawing preview"]')
      .locator("#geometry"),
  ).toHaveAttribute("transform", "translate(20 15) scale(2)");
  await page.getByRole("button", { name: "Drawing", exact: true }).click();
  const paths = Array.from(
    { length: 700 },
    (_, i) => `<path id="part-${i}" class="mark" d="M0 0L100 0L50 50Z"/>`,
  ).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><!--${"private-source-marker ".repeat(6000)}--><style>.mark{fill:url(#paint)}</style><defs><linearGradient id="paint"><stop offset="0" stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient></defs>${paths}</svg>`;
  await attachFiles(page, {
    name: "complex-logo.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(svg),
  });
  await expect(page.getByText("Reading attachment…")).toHaveCount(0);
  await page
    .getByLabel("Drawing instructions")
    .fill("place original logo; recover completion");
  await page.getByRole("button", { name: "Send drawing instruction" }).click();
  await expect.poll(() => requests.length).toBe(4);
  const frame = page.frameLocator('iframe[title="Technical drawing preview"]');
  await expect(frame.locator("#brand")).toHaveCount(0);
  expect(JSON.stringify(requests)).not.toContain("private-source-marker");
  expect(JSON.stringify(requests)).not.toContain("M0 0L100 0L50 50Z");
  expect(JSON.stringify(requests[0].messages)).not.toContain("image_url");
  expect(JSON.stringify(requests[1].messages)).toContain("image_url");
  expect(requests[0].tools.map((tool: any) => tool.function.name)).toEqual(
    expect.arrayContaining([
      "inspect_resource",
      "place_svg",
      "transform_object",
    ]),
  );
  release();
  await expect(
    page.getByText("Original logo placed.", { exact: true }),
  ).toBeVisible();
  expect(completionAttempts).toBe(2);
  expect(requests).toHaveLength(5);
  expect(requests[4].messages.filter((m: any) => m.role === "tool")).toEqual(
    requests[3].messages.filter((m: any) => m.role === "tool"),
  );
  await expect(frame.locator("#brand path")).toHaveCount(700);
  await expect(frame.locator("#brand path").first()).toHaveAttribute(
    "d",
    "M0 0L100 0L50 50Z",
  );
  const transform = await frame.locator("#brand").evaluate((element) => {
    const root =
      element.ownerDocument.querySelector<SVGSVGElement>("#drawing")!;
    const viewport =
      root.querySelector<SVGGraphicsElement>(".svg-pan-zoom_viewport") || root;
    const matrix = viewport
      .getScreenCTM()!
      .inverse()
      .multiply((element as SVGGraphicsElement).getScreenCTM()!);
    return { a: matrix.a, b: matrix.b, e: matrix.e, f: matrix.f };
  });
  const radians = (10 * Math.PI) / 180;
  expect(transform.a).toBeCloseTo(0.1 * Math.cos(radians), 4);
  expect(transform.b).toBeCloseTo(0.1 * Math.sin(radians), 4);
  expect(transform.e).toBeCloseTo(
    1 + 0.5 * (90 * Math.cos(radians) - 5 * Math.sin(radians)),
    3,
  );
  expect(transform.f).toBeCloseTo(
    2 + 0.5 * (90 * Math.sin(radians) + 5 * Math.cos(radians)),
    3,
  );
  await expect(frame.locator("#brand svg")).toHaveAttribute("stroke", "none");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(frame.locator("#brand")).toHaveCount(0);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(frame.locator("#brand path")).toHaveCount(700);
  await waitForProjectSave(page);
  await page.reload();
  await expect(frame.locator("#brand path")).toHaveCount(700);
  await page.getByLabel("Drawing instructions").fill("reuse stored reference");
  await page.getByRole("button", { name: "Send drawing instruction" }).click();
  await expect(
    page.getByText("Stored reference is available.", { exact: true }),
  ).toBeVisible();
  const read = requests.at(-1).messages.findLast((m: any) => m.role === "tool");
  expect(JSON.parse(read.content).text.length).toBe(120);
  await page.getByRole("button", { name: "New Drawing", exact: true }).click();
  await page.getByLabel("Drawing instructions").fill("access other project");
  await page.getByRole("button", { name: "Send drawing instruction" }).click();
  await expect(
    page.getByText("Resource access denied.", { exact: true }),
  ).toBeVisible();
  expect(
    JSON.parse(
      requests.at(-1).messages.findLast((m: any) => m.role === "tool").content,
    ).ok,
  ).toBe(false);
});

async function prepareMeasuredLogo(page: Page) {
  await page.getByRole("button", { name: "Code", exact: true }).click();
  await page
    .getByLabel("Drawing source code")
    .fill(
      '<svg xmlns="http://www.w3.org/2000/svg" id="drawing" width="120mm" height="80mm" viewBox="-10 -10 120 80"><g id="geometry" data-layer="geometry"><rect id="plate" width="100" height="60" rx="5" fill="white" stroke="black"/></g><g id="dimensions" data-layer="dimensions"><g id="dim" data-for="plate"><text x="50" y="-3">100 × 60 R5</text></g></g></svg>',
    );
  await page.getByRole("button", { name: "Apply code", exact: true }).click();
  const frame = page.frameLocator('iframe[title="Technical drawing preview"]');
  await expect(frame.locator("#plate")).toHaveAttribute("rx", "5");
  await page.getByRole("button", { name: "Drawing", exact: true }).click();
  await attachFiles(page, {
    name: "offset-logo.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 800"><path id="art" d="M310 120h20v10h-20Z"/></svg>',
    ),
  });
  await expect(page.getByText("Reading attachment…")).toHaveCount(0);
  return frame;
}

test("measured placement survives failed completion, selection review and one undo/redo without duplicate insertion", async ({
  page,
}) => {
  const frame = await prepareMeasuredLogo(page);
  const originalPlate = await frame
    .locator("#plate")
    .evaluate((node) => node.outerHTML);
  const originalDimensions = await frame
    .locator("#dimensions")
    .evaluate((node) => node.outerHTML);
  await frame.locator("#plate").click({ position: { x: 10, y: 10 } });
  await page.getByLabel("Drawing instructions").fill("center measured logo");
  await page.getByRole("button", { name: "Send drawing instruction" }).click();
  await expect.poll(() => requests.length).toBe(2);
  await expect(frame.locator("#brand")).toHaveCount(0);
  const advertised = requests[0].tools.find(
    (entry: any) => entry.function.name === "place_svg",
  ).function;
  expect(advertised.parameters.required).toContain("bounds");
  expect(advertised.parameters.properties.bounds.enum).toEqual([
    "content",
    "canvas",
  ]);
  expect(advertised.description).toContain("anchor:center");
  release();
  await expect(
    page.getByRole("region", { name: "Review AI changes" }),
  ).toBeVisible();
  expect(completionAttempts).toBe(2);
  expect(requests).toHaveLength(3);
  expect(
    requests[2].messages.filter((message: any) => message.role === "tool"),
  ).toEqual(
    requests[1].messages.filter((message: any) => message.role === "tool"),
  );
  await page
    .getByRole("button", { name: "Apply AI changes", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Review AI changes" }),
  ).toHaveCount(0);
  await expect(frame.locator("#brand")).toHaveCount(1);
  const bounds = await frame.locator("#brand path").evaluate((node) => {
    const root = node.ownerDocument.querySelector<SVGSVGElement>("#drawing")!;
    const viewport = root.querySelector<SVGGraphicsElement>(
      ".svg-pan-zoom_viewport",
    )!;
    const inverse = viewport.getScreenCTM()!.inverse();
    const rect = node.getBoundingClientRect();
    const start = new DOMPoint(rect.x, rect.y).matrixTransform(inverse);
    const end = new DOMPoint(rect.right, rect.bottom).matrixTransform(inverse);
    return {
      width: end.x - start.x,
      height: end.y - start.y,
      centerX: (start.x + end.x) / 2,
      centerY: (start.y + end.y) / 2,
    };
  });
  expect(bounds.width).toBeCloseTo(40, 4);
  expect(bounds.height).toBeCloseTo(20, 4);
  expect(bounds.centerX).toBeCloseTo(50, 4);
  expect(bounds.centerY).toBeCloseTo(30, 4);
  expect(await frame.locator("#plate").evaluate((node) => node.outerHTML)).toBe(
    originalPlate,
  );
  expect(
    await frame.locator("#dimensions").evaluate((node) => node.outerHTML),
  ).toBe(originalDimensions);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(frame.locator("#brand")).toHaveCount(0);
  await expect(frame.locator("#plate")).toHaveAttribute("rx", "5");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(frame.locator("#brand path")).toHaveCount(1);
  await waitForProjectSave(page);
  await page.reload();
  await expect(frame.locator("#brand path")).toHaveCount(1);
});

test("cancelling a staged measured placement preserves the committed plate", async ({
  page,
}) => {
  const frame = await prepareMeasuredLogo(page);
  await page.getByLabel("Drawing instructions").fill("center measured logo");
  await page.getByRole("button", { name: "Send drawing instruction" }).click();
  await expect.poll(() => requests.length).toBe(2);
  await page.getByRole("button", { name: "Stop generation" }).click();
  await expect(frame.locator("#brand")).toHaveCount(0);
  await expect(frame.locator("#plate")).toHaveAttribute("rx", "5");
  await waitForProjectSave(page);
  await page.reload();
  await expect(frame.locator("#brand")).toHaveCount(0);
  await expect(frame.locator("#plate")).toHaveAttribute("width", "100");
});

// A small real two-page PDF, without fonts, JS actions, remote files or fixture dependencies.
function twoPagePdf() {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 7 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 200] /Resources << >> /Contents 6 0 R >>",
    (() => {
      const content =
        "1 0 0 rg 10 10 60 30 re f\nBT /F1 12 Tf 10 60 Td (Width 40 mm) Tj ET\n";
      return `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`;
    })(),
    "<< /Length 25 >>\nstream\n0 0 1 rg 10 10 30 60 re f\nendstream",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let file = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, value] of objects.entries()) {
    offsets.push(Buffer.byteLength(file));
    file += `${index + 1} 0 obj\n${value}\nendobj\n`;
  }
  const xref = Buffer.byteLength(file);
  file += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((n) => `${String(n).padStart(10, "0")} 00000 n \n`)
    .join(
      "",
    )}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(file);
}

test("PDF tools render a selected page locally and send its bounded preview, with page-wise text access", async ({
  page,
}) => {
  await attachFiles(page, {
    name: "two-pages.pdf",
    mimeType: "application/pdf",
    buffer: twoPagePdf(),
  });
  await expect(page.getByText("Reading attachment…")).toHaveCount(0);
  await page.getByLabel("Drawing instructions").fill("inspect PDF page");
  await page.getByRole("button", { name: "Send drawing instruction" }).click();
  await expect(
    page.getByText("Selected PDF page inspected.", { exact: true }),
  ).toBeVisible();
  const inspection = JSON.parse(
    requests[1].messages.find((m: any) => m.role === "tool").content,
  );
  expect(inspection).toMatchObject({
    ok: true,
    pages: 2,
    page: 2,
    width: 100,
    height: 200,
  });
  expect(JSON.stringify(requests[0].messages)).not.toContain("image_url");
  expect(JSON.stringify(requests[1].messages)).toContain("image_url");
  expect(JSON.stringify(requests)).not.toContain("file_data");
  expect(
    JSON.parse(
      requests[2].messages.findLast((m: any) => m.role === "tool").content,
    ),
  ).toMatchObject({
    ok: true,
    page: 1,
    text: expect.stringContaining("Width 40 mm"),
  });
});

test("DXF geometry is previewed in a bounded local worker while original text stays out of default context", async ({
  page,
}) => {
  const text =
    "0\nSECTION\n2\nENTITIES\n0\nCIRCLE\n8\n0\n10\n20\n20\n30\n30\n0\n40\n10\n0\nENDSEC\n0\nEOF\n";
  await attachFiles(page, {
    name: "circle.dxf",
    mimeType: "application/dxf",
    buffer: Buffer.from(text),
  });
  await expect(page.getByText("Reading attachment…")).toHaveCount(0);
  await page.getByLabel("Drawing instructions").fill("inspect DXF geometry");
  await page.getByRole("button", { name: "Send drawing instruction" }).click();
  await expect(
    page.getByText("DXF geometry inspected.", { exact: true }),
  ).toBeVisible();
  expect(JSON.stringify(requests[0].messages)).not.toContain("ENTITIES");
  const result = JSON.parse(
    requests[1].messages.find((m: any) => m.role === "tool").content,
  );
  expect(result).toMatchObject({
    ok: true,
    entities: 1,
    entityTypes: { CIRCLE: 1 },
  });
  expect(JSON.stringify(requests[1].messages)).toContain("image_url");
});

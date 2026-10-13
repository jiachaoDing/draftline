import { test, expect } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { EXAMPLE_SVG } from "../../src/lib/example";

let provider: Server;
let baseURL: string;
let requests: Record<string, unknown>[] = [];
test.beforeAll(async () => {
  provider = createServer(async (req, res) => {
    let data = "";
    for await (const chunk of req) data += chunk;
    res.setHeader("Content-Type", "application/json");
    if (req.headers.authorization !== "Bearer browser-test-key") {
      res.writeHead(401);
      res.end("{}");
      return;
    }
    if (req.url === "/v1/models") {
      res.end(
        JSON.stringify({
          object: "list",
          data: [{ id: "vision-test", object: "model" }],
        }),
      );
      return;
    }
    const input = JSON.parse(data);
    requests.push(input);
    const content = input.messages.at(-1).content;
    const instruction = typeof content === "string" ? content : content[0].text;
    let output: unknown;
    if (instruction === "Reply with OK.") output = "OK";
    else if (instruction.includes("Selected element: hole-top-left"))
      output = {
        kind: "patch",
        summary:
          "Changed the selected hole to Ø14 mm. Other holes are unchanged.",
        patches: [
          {
            id: "hole-top-left",
            svg: '<circle id="hole-top-left" data-label="Top left hole" cx="20" cy="20" r="7" fill="white" />',
          },
          {
            id: "dim-hole",
            svg: '<g id="dim-hole" data-for="hole-top-left hole-top-right hole-bottom-left hole-bottom-right"><path d="M24 16 L34 6 H66" marker-start="url(#arrow)"/><text x="37" y="4" fill="#66758b" stroke="none">Ø14; 3 × Ø10</text></g>',
          },
        ],
      };
    else if (
      instruction.includes("missing width") &&
      !instruction.includes("User clarification:")
    )
      output = {
        kind: "clarification",
        question: "What is the plate width in millimeters?",
      };
    else
      output = {
        kind: "drawing",
        title: "Generated test plate",
        summary: "Generated the plate with a Ø12 top-left hole.",
        notes: instruction.includes("Material:")
          ? ["Material: 3 mm stainless steel.", "Deburr edges."]
          : [],
        html: `${EXAMPLE_SVG}<script>document.getElementById('hole-top-left').setAttribute('r','6');document.querySelector('#dim-hole text').textContent='Ø12; 3 × Ø10';try { parent.localStorage.setItem('sandbox-leak','failed'); } catch { document.getElementById('drawing').setAttribute('data-isolated','true'); } fetch('https://example.com/sandbox-leak').catch(()=>{});</script>`,
      };
    res.end(
      JSON.stringify({
        id: "fixture",
        object: "chat.completion",
        created: 0,
        model: "vision-test",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content:
                typeof output === "string" ? output : JSON.stringify(output),
            },
            finish_reason: "stop",
          },
        ],
      }),
    );
  });
  await new Promise<void>((resolve) =>
    provider.listen(0, "127.0.0.1", resolve),
  );
  baseURL = `http://127.0.0.1:${(provider.address() as { port: number }).port}/v1`;
});
test.afterAll(
  () => new Promise<void>((resolve) => provider.close(() => resolve())),
);

test("sketch → clarification → generated code → targeted edit → undo/redo → SVG", async ({
  page,
}) => {
  requests = [];
  const leakedRequests: string[] = [];
  page.on("request", (req) => {
    if (req.url().includes("example.com/sandbox-leak"))
      leakedRequests.push(req.url());
  });
  await page.goto("/");
  const frame = page.frameLocator('iframe[title="Technical drawing preview"]');
  await expect(frame.locator("#plate-outline")).toHaveAttribute("width", "120");
  await expect(page.getByText("5 geometry elements")).toBeVisible();
  await expect
    .poll(
      async () =>
        (await frame.locator("#plate-outline").boundingBox())?.width || 0,
    )
    .toBeGreaterThan(100);

  await page.getByRole("button", { name: "Model settings" }).click();
  await page.getByLabel("Base URL", { exact: true }).fill(baseURL);
  await page.getByLabel("API key", { exact: true }).fill("browser-test-key");
  await page.getByRole("button", { name: "Discover models" }).click();
  await expect(
    page.getByText("1 models found.", { exact: false }),
  ).toBeVisible();
  await page.getByLabel("Model", { exact: true }).fill("vision-test");
  await page.getByRole("button", { name: "Test connection" }).click();
  await expect(
    page.getByText("Connected. Your selected model responded successfully."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save settings" }).click();

  await page.getByRole("button", { name: "Just exploring?" }).click();
  await expect(page.getByAltText("Uploaded sketch")).toBeVisible();
  await page
    .getByLabel("Drawing instructions")
    .fill(
      "Draw this plate with missing width. Material: 3 mm stainless steel. Deburr edges.",
    );
  await page
    .getByRole("button", { name: "Generate drawing", exact: true })
    .click();
  await expect(
    page.getByText("What is the plate width in millimeters?"),
  ).toBeVisible();
  await page
    .getByLabel("Ask AI to edit drawing")
    .fill("120 mm wide, 80 mm high.");
  await page.getByRole("button", { name: "Send drawing instruction" }).click();
  await expect(frame.locator("#hole-top-left")).toHaveAttribute("r", "6");
  await expect(frame.locator("#presentation")).toContainText(
    "Material: 3 mm stainless steel.",
  );
  await expect(frame.locator('#presentation [data-field="scale"]')).toHaveText(
    "1:1",
  );
  await expect(
    page.getByText("Generated test plate", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem("sandbox-leak")),
  ).toBeNull();
  expect(leakedRequests).toEqual([]);
  expect(
    requests.some((r) => JSON.stringify(r).includes("image_url")),
  ).toBeTruthy();

  await frame.locator("#hole-top-left").click();
  await expect(
    page.getByText("SELECTED ELEMENT", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Ask AI to edit drawing")
    .fill("Change this hole to Ø14 mm.");
  await page.getByRole("button", { name: "Send drawing instruction" }).click();
  await expect(frame.locator("#hole-top-left")).toHaveAttribute("r", "7");
  await expect(frame.locator("#hole-top-right")).toHaveAttribute("r", "5");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(frame.locator("#hole-top-left")).toHaveAttribute("r", "6");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(frame.locator("#hole-top-left")).toHaveAttribute("r", "7");
  await page.getByLabel("Show dimensions").uncheck();
  await expect(frame.locator("#dimensions")).toHaveAttribute("display", "none");
  await page.getByLabel("Show presentation").uncheck();
  await expect(frame.locator("#presentation")).toHaveAttribute(
    "display",
    "none",
  );
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await page.getByRole("button", { name: "Pan tool", exact: true }).click();
  await expect(frame.locator("body")).toHaveAttribute("data-mode", "pan");

  await page.getByRole("button", { name: "Export SVG" }).click();
  const geometryDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Geometry only" }).click();
  const download = await geometryDownload;
  const stream = await download.createReadStream();
  let exported = "";
  for await (const chunk of stream!) exported += chunk.toString();
  expect(exported).toContain('width="164mm"');
  expect(exported).toContain('viewBox="-22 -22 164 124"');
  expect(exported).toContain('r="7"');
  expect(exported).not.toContain('id="dimensions"');
  expect(exported).not.toContain('id="presentation"');
  expect(exported).not.toMatch(
    /script|svg-pan-zoom|data-selected|browser-test-key/,
  );
  await page.getByRole("button", { name: "Export SVG" }).click();
  const annotatedDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "With dimensions" }).click();
  const annotated = await annotatedDownload;
  const annotatedStream = await annotated.createReadStream();
  let dimensioned = "";
  for await (const chunk of annotatedStream!) dimensioned += chunk.toString();
  expect(dimensioned).toContain('id="dimensions"');
  expect(dimensioned).toContain("Ø14");
  expect(dimensioned).toContain('id="presentation"');
  expect(dimensioned).toContain("Material: 3 mm stainless steel.");
  expect(dimensioned).toContain("Deburr edges.");
  expect(dimensioned).toContain(">1:1</text>");
  expect(dimensioned).not.toContain('display="none"');
  const stored = await page.evaluate(() =>
    JSON.stringify({ ...localStorage, ...sessionStorage }),
  );
  expect(stored).not.toContain("browser-test-key");
  await page.reload();
  await expect(frame.locator("#hole-top-left")).toHaveAttribute("r", "7");
  await expect(frame.locator("#presentation")).toContainText(
    "Material: 3 mm stainless steel.",
  );
  await page.getByRole("button", { name: "Model settings" }).click();
  await expect(page.getByLabel("API key", { exact: true })).toHaveValue("");
});

test("upload and clipboard paste accept images; invalid files fail safely", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Upload sketch image").setInputFiles({
    name: "bad.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from("<svg/>"),
  });
  await expect(page.getByRole("alert")).toContainText("Choose a PNG");
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=",
    "base64",
  );
  await page
    .getByLabel("Upload sketch image")
    .setInputFiles({ name: "sketch.png", mimeType: "image/png", buffer: png });
  await expect(page.getByAltText("Uploaded sketch")).toBeVisible();
  await page.getByRole("button", { name: "Remove sketch" }).click();
  await page.evaluate((base64) => {
    const file = new File(
      [Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))],
      "pasted.png",
      { type: "image/png" },
    );
    const transfer = new DataTransfer();
    transfer.items.add(file);
    document.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true }),
    );
  }, png.toString("base64"));
  await expect(page.getByText("pasted.png")).toBeVisible();
});

test("code editor executes synchronous SVG JavaScript and isolates parent access", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Code", exact: true }).click();
  await page
    .getByLabel("Drawing source code")
    .fill(
      `${EXAMPLE_SVG}<script>document.querySelector('#plate-outline').setAttribute('width','125');try{parent.document.body.innerHTML='breach'}catch{document.querySelector('#plate-outline').setAttribute('data-sandbox','isolated')}</script>`,
    );
  await page.getByRole("button", { name: "Apply code" }).click();
  const frame = page.frameLocator('iframe[title="Technical drawing preview"]');
  await expect(frame.locator("#plate-outline")).toHaveAttribute("width", "125");
  await expect(page.getByRole("button", { name: "Export SVG" })).toBeVisible();
  await expect(frame.locator("#plate-outline")).toHaveAttribute(
    "data-sandbox",
    "isolated",
  );
});

test("mobile layout keeps core controls within viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Generate drawing", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await expect
    .poll(() =>
      page
        .locator(".studio")
        .evaluate((node) => getComputedStyle(node).display),
    )
    .toBe("flex");
  expect(
    (await page.locator(".drawing-workspace").boundingBox())?.width,
  ).toBeLessThanOrEqual(390);
  await page.getByRole("button", { name: "Model settings" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("sandbox blocks external navigation and retains the previous drawing", async ({
  page,
}) => {
  const leaked: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("example.com/navigation-probe"))
      leaked.push(request.url());
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Code", exact: true }).click();
  await page
    .getByLabel("Drawing source code")
    .fill(
      `${EXAMPLE_SVG}<script>location.href='https://example.com/navigation-probe';document.querySelector('#hole-top-left').setAttribute('r','8')</script>`,
    );
  await page.getByRole("button", { name: "Apply code" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Drawing preview did not finish",
    { timeout: 8000 },
  );
  await expect(
    page.frameLocator("iframe").locator("#hole-top-left"),
  ).toHaveAttribute("r", "5");
  expect(leaked).toEqual([]);
});

import { waitForProjectSave } from "../helpers/project-storage";
import { test, expect } from "../helpers/workspace-test";
import { createServer, type Server } from "node:http";
import { attachFiles } from "../helpers/attach-files";
import { EXAMPLE_SVG } from "../../src/lib/example";
import {
  completeResponse,
  openCompletion,
  contentChunk,
  finishCompletion,
} from "../helpers/provider-stream";

let provider: Server;
let baseURL: string;
let requests: Record<string, unknown>[] = [];
let releaseStream: () => void;
let upstreamCancelled = false;
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
    if (instruction.includes("streaming conversation test")) {
      openCompletion(res);
      contentChunk(res, '{"kind":"message","message":"This plate');
      await new Promise<void>((resolve) => {
        releaseStream = resolve;
      });
      if (!res.destroyed) {
        contentChunk(res, ' has four holes."}');
        finishCompletion(res);
      }
      return;
    }
    if (instruction.includes("streaming drawing test")) {
      openCompletion(res);
      contentChunk(
        res,
        JSON.stringify({
          kind: "drawing",
          title: "Streaming test plate",
          summary: "Preparing a revised plate.",
          notes: [],
          html: `${EXAMPLE_SVG}<script>document.getElementById('hole-top-left').setAttribute('r','9')</script>`,
        }),
      );
      await new Promise<void>((resolve) => {
        releaseStream = resolve;
      });
      if (!res.destroyed) finishCompletion(res);
      return;
    }
    if (instruction.includes("cancel streaming test")) {
      upstreamCancelled = false;
      res.once("close", () => {
        upstreamCancelled = true;
      });
      openCompletion(res);
      contentChunk(res, '{"kind":"message","message":"Working on your update');
      return;
    }
    if (instruction.includes("disconnect streaming test")) {
      openCompletion(res);
      contentChunk(res, '{"kind":"message","message":"Partial reply"}');
      res.end();
      return;
    }
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
    completeResponse(
      res,
      typeof output === "string" ? output : JSON.stringify(output),
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
  await expect(frame.locator("#plate-outline")).toHaveAttribute(
    "width",
    "120",
    { timeout: 10000 },
  );
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
  await page.getByLabel("Model", { exact: true }).click();
  await page.getByRole("option", { name: "vision-test", exact: true }).click();
  await page.getByRole("button", { name: "Test connection" }).click();
  await expect(
    page.getByText("Connected. Your selected model responded successfully."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save settings" }).click();

  await page.getByRole("button", { name: "New Drawing", exact: true }).click();
  await expect(frame.locator("#plate-outline")).toHaveCount(0);
  await page.getByRole("button", { name: "Try an example" }).click();
  await expect(page.locator(".composer-attachment img")).toBeVisible();
  await page
    .getByLabel("Drawing instructions")
    .fill(
      "Draw this plate with missing width. Material: 3 mm stainless steel. Deburr edges.",
    );
  await page
    .getByRole("button", { name: "Send drawing instruction", exact: true })
    .click();
  await expect(
    page.getByText("What is the plate width in millimeters?"),
  ).toBeVisible();
  await page
    .getByLabel("Drawing instructions")
    .fill("120 mm wide, 80 mm high.");
  await page.getByRole("button", { name: "Send drawing instruction" }).click();
  await expect(
    page.getByRole("button", { name: "New Drawing", exact: true }),
  ).toBeEnabled({ timeout: 10_000 });
  await expect(frame.locator("#hole-top-left")).toHaveAttribute("r", "6");
  await expect(frame.locator("#presentation")).toContainText(
    "Material: 3 mm stainless steel.",
  );
  await expect(frame.locator('#presentation [data-field="scale"]')).toHaveText(
    "1:1",
  );
  await expect(
    page
      .locator(".canvas-document-heading")
      .getByText("Generated test plate", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem("sandbox-leak")),
  ).toBeNull();
  expect(leakedRequests).toEqual([]);
  await page.getByRole("button", { name: "Code", exact: true }).click();
  await expect(page.locator(".cm-line").first()).toHaveText("<!doctype html>");
  await expect(page.locator(".cm-line").nth(1)).toHaveText("<html>");
  await expect(page.locator(".cm-line").nth(2)).toHaveText("  <body>");
  await page.getByRole("button", { name: "Drawing", exact: true }).click();
  expect(requests.some((r) => JSON.stringify(r).includes("image_url"))).toBe(
    false,
  );
  expect(JSON.stringify(requests)).toContain("Project resource catalog");

  await frame.locator("#hole-top-left").click();
  await expect(
    page.getByText("SELECTED ELEMENT", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Drawing instructions")
    .fill("Change this hole to Ø14 mm.");
  await page.getByRole("button", { name: "Send drawing instruction" }).click();
  await expect(frame.locator("#hole-top-left")).toHaveAttribute("r", "7");
  await expect(frame.locator("#hole-top-right")).toHaveAttribute("r", "5");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(frame.locator("#hole-top-left")).toHaveAttribute("r", "6");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(frame.locator("#hole-top-left")).toHaveAttribute("r", "7");
  await page
    .getByRole("button", { name: "Drawing layers", exact: true })
    .click();
  await page.getByLabel("Show dimensions").uncheck();
  await expect(frame.locator("#dimensions")).toHaveAttribute("display", "none");
  await page.getByLabel("Show presentation").uncheck();
  await expect(frame.locator("#presentation")).toHaveAttribute(
    "display",
    "none",
  );
  await page.keyboard.press("Escape");
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
  expect(JSON.parse(stored)["draftline-model"]).toContain("browser-test-key");
  expect(page.url()).not.toContain("browser-test-key");
  await waitForProjectSave(page);
  await page.reload();
  await expect(frame.locator("#hole-top-left")).toHaveAttribute("r", "7");
  await expect(frame.locator("#presentation")).toContainText(
    "Material: 3 mm stainless steel.",
  );
  await page.getByRole("button", { name: "Model settings" }).click();
  await expect(page.getByLabel("API key", { exact: true })).toHaveValue(
    "browser-test-key",
  );
  await expect(page.getByLabel("Base URL", { exact: true })).toHaveValue(
    baseURL,
  );
  await expect(page.getByLabel("Model", { exact: true })).toHaveValue(
    "vision-test",
  );
});

test("upload and clipboard paste accept images; invalid files fail safely", async ({
  page,
}) => {
  await page.goto("/");
  await attachFiles(page, {
    name: "oversize.png",
    mimeType: "image/png",
    buffer: Buffer.alloc(9 * 1024 * 1024),
  });
  await expect(page.getByRole("alert")).toContainText("8 MB");
  await expect(page.getByRole("alert")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Send drawing instruction" }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Remove attachment oversize.png" })
    .click();
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=",
    "base64",
  );
  await attachFiles(page, {
    name: "sketch.png",
    mimeType: "image/png",
    buffer: png,
  });
  await expect(page.locator(".composer-attachment img")).toBeVisible();
  await page
    .getByRole("button", { name: "Remove attachment sketch.png" })
    .click();
  await page.evaluate((base64) => {
    const file = new File(
      [Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))],
      "pasted.png",
      { type: "image/png" },
    );
    const transfer = new DataTransfer();
    transfer.items.add(file);
    document
      .querySelector("textarea")!
      .dispatchEvent(
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
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(frame.locator("#plate-outline")).toHaveAttribute("width", "120");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(frame.locator("#plate-outline")).toHaveAttribute("width", "125");
});

test("source editor highlights, wraps and formats drafts with its own undo history", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Code", exact: true }).click();
  const editor = page.getByLabel("Drawing source code");
  await expect(page.locator(".cm-lineNumbers")).toBeVisible();
  await expect(page.locator(".cm-content")).toHaveCSS(
    "white-space",
    "break-spaces",
  );
  expect(await page.locator(".cm-line span").count()).toBeGreaterThan(0);
  const source =
    "<html><body><svg><text>Ø10 mm</text></svg><script>const n=1;console.log(n);</script></body></html>";
  await editor.press("ControlOrMeta+a");
  await page.keyboard.insertText(source);
  await page.getByRole("button", { name: "Format", exact: true }).click();
  await expect(editor).toContainText("const n = 1;");
  await expect(page.locator(".cm-line").first()).toHaveText("<html>");
  await editor.press("ControlOrMeta+z");
  await expect(page.locator(".cm-line")).toHaveCount(1);
  await expect(editor).toHaveText(source);
  await editor.press("ControlOrMeta+Shift+Z");
  await expect(editor).toContainText("const n = 1;");
  await expect(
    page.getByRole("button", { name: "Undo", exact: true }),
  ).toBeDisabled();
  await editor.press("ControlOrMeta+a");
  await page.keyboard.insertText("<svg><g></svg>");
  await page.getByRole("button", { name: "Format", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Could not format source",
  );
  await expect(editor).toHaveText("<svg><g></svg>");
  await page.getByRole("button", { name: "Apply code" }).click();
  await expect(page.getByRole("alert")).toContainText("SVG with id drawing");
  await expect(
    page
      .frameLocator('iframe[title="Technical drawing preview"]')
      .locator("#hole-top-left"),
  ).toHaveAttribute("r", "5");
  await page.getByRole("button", { name: "Code", exact: true }).click();
  await expect(editor).toHaveText("<svg><g></svg>");
});

test("mobile layout keeps core controls within viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Send drawing instruction", exact: true }),
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
  await page.getByRole("button", { name: "Code", exact: true }).click();
  const editor = page.getByLabel("Drawing source code");
  await editor.fill(`<svg><text>${"x".repeat(1500)}</text></svg>`);
  await expect(
    page.getByRole("button", { name: "Format", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Apply code" })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  expect(
    await page
      .locator(".cm-scroller")
      .evaluate((node) => node.scrollWidth - node.clientWidth),
  ).toBeLessThanOrEqual(1);
  await page.getByRole("button", { name: "Drawing", exact: true }).click();
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
    "Drawing validation did not finish",
    { timeout: 8000 },
  );
  await expect(
    page
      .frameLocator('iframe[title="Technical drawing preview"]')
      .locator("#hole-top-left"),
  ).toHaveAttribute("r", "5");
  expect(leaked).toEqual([]);
});

async function connectModel(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Model settings" }).click();
  await page.getByLabel("Base URL", { exact: true }).fill(baseURL);
  await page.getByLabel("API key", { exact: true }).fill("browser-test-key");
  await page.getByLabel("Model", { exact: true }).fill("vision-test");
  await page.getByRole("button", { name: "Save settings" }).click();
}

test("projects retain drawings, conversations, references and isolated AI context", async ({
  page,
}) => {
  await connectModel(page);
  await page.getByRole("button", { name: "New Drawing", exact: true }).click();
  await expect(
    page.getByText("A fresh page for your next idea."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Export SVG" })).toBeDisabled();
  await page
    .getByRole("button", {
      name: "Drawing actions for Untitled drawing",
      exact: true,
    })
    .click();
  await page
    .getByRole("menuitem", {
      name: "Rename drawing Untitled drawing",
      exact: true,
    })
    .click();
  await page.getByLabel("Project name", { exact: true }).fill("Bracket A");
  await page.getByRole("button", { name: "Save project name" }).click();
  await page.getByRole("button", { name: "Try an example" }).click();
  await expect(page.locator(".composer-attachment img")).toBeVisible();
  await page
    .getByLabel("Drawing instructions")
    .fill("Project A only: missing width");
  await page.getByRole("button", { name: "Send drawing instruction" }).click();
  await expect(
    page.getByText("What is the plate width in millimeters?"),
  ).toBeVisible();
  await page.getByRole("button", { name: "New Drawing", exact: true }).click();
  await expect(
    page.getByText("What is the plate width in millimeters?"),
  ).toHaveCount(0);
  await expect(page.locator(".composer-attachment img")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Undo", exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel("Drawing instructions")
    .fill("Project B only: 120 × 80 mm plate");
  await page.getByRole("button", { name: "Send drawing instruction" }).click();
  const frame = page.frameLocator('iframe[title="Technical drawing preview"]');
  await expect(frame.locator("#hole-top-left")).toHaveAttribute("r", "6");
  const requestB = JSON.stringify(requests.at(-1));
  expect(requestB).toContain("Project B only");
  expect(requestB).not.toContain("Project A only");
  expect(requestB).not.toContain("Current SVG");
  expect(requestB).not.toContain("image_url");
  await page
    .getByRole("button", { name: "Open drawing Bracket A", exact: true })
    .click();
  await expect(
    page.getByText("What is the plate width in millimeters?"),
  ).toBeVisible();
  await expect(
    page.locator(".chat-message.user .message-reference img"),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("What is the plate width in millimeters?"),
  ).toBeVisible();
  await expect(
    page.locator(".chat-message.user .message-reference img"),
  ).toBeVisible();
  await page.getByLabel("Drawing instructions").fill("120 mm wide, 80 mm high");
  await page.getByRole("button", { name: "Send drawing instruction" }).click();
  await expect(frame.locator("#hole-top-left")).toHaveAttribute("r", "6");
  expect(JSON.stringify(requests.at(-1))).toContain("User clarification:");
  expect(JSON.stringify(requests.at(-1))).not.toContain("Project B only");
  await expect(
    page.getByRole("button", { name: "Open drawing Bracket A", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Drawing actions for Generated test plate",
      exact: true,
    })
    .click();
  await page
    .getByRole("menuitem", {
      name: "Delete drawing Generated test plate",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: "Open drawing Generated test plate",
      exact: true,
    }),
  ).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("button", {
      name: "Open drawing Generated test plate",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(frame.locator("#hole-top-left")).toHaveAttribute("r", "6");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({
    path: ".generated/draftline-projects.png",
    fullPage: true,
  });
});

test("settings update and clear persist without credentials in requests URLs or drawing context", async ({
  page,
}) => {
  const urls: string[] = [];
  page.on("request", (request) => urls.push(request.url()));
  await connectModel(page);
  await page.getByRole("button", { name: "Model settings" }).click();
  await page.getByLabel("API key", { exact: true }).fill("updated-local-key");
  await page.getByLabel("Model", { exact: true }).fill("updated-model");
  await page.getByRole("button", { name: "Save settings" }).click();
  await page.reload();
  await page.getByRole("button", { name: "Model settings" }).click();
  await expect(page.getByLabel("API key", { exact: true })).toHaveValue(
    "updated-local-key",
  );
  await expect(page.getByLabel("Model", { exact: true })).toHaveValue(
    "updated-model",
  );
  await page.getByRole("button", { name: "Clear saved settings" }).click();
  expect(
    await page.evaluate(() => localStorage.getItem("draftline-model")),
  ).toBeNull();
  await page.reload();
  await page.getByRole("button", { name: "Model settings" }).click();
  await expect(page.getByLabel("API key", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Model", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Base URL", { exact: true })).toHaveValue(
    "https://api.openai.com/v1",
  );
  expect(urls.join(" ")).not.toMatch(/browser-test-key|updated-local-key/);
});

test("projects and large references survive a full browser restart", async ({
  playwright,
}, testInfo) => {
  test.setTimeout(120_000);
  const profile = testInfo.outputPath("browser-profile");
  const options = {
    channel: process.env.PLAYWRIGHT_CHANNEL || "msedge",
    headless: true,
    baseURL: test.info().project.use.baseURL,
    viewport: { width: 1440, height: 900 },
  };
  let context = await playwright.chromium.launchPersistentContext(
    profile,
    options,
  );
  await context.addInitScript(() => {
    if (window === window.top && !localStorage.getItem("draftline-language"))
      localStorage.setItem("draftline-language", "en");
  });
  try {
    let page = await context.newPage();
    await connectModel(page);
    await page
      .getByRole("button", { name: "New Drawing", exact: true })
      .click();
    await page
      .getByRole("button", {
        name: "Drawing actions for Untitled drawing",
        exact: true,
      })
      .click();
    await page
      .getByRole("menuitem", {
        name: "Rename drawing Untitled drawing",
        exact: true,
      })
      .click();
    await page
      .getByLabel("Project name", { exact: true })
      .fill("Restart project");
    await page.getByRole("button", { name: "Save project name" }).click();
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=",
      "base64",
    );
    await attachFiles(page, {
      name: "large-reference.png",
      mimeType: "image/png",
      buffer: Buffer.concat([png, Buffer.alloc(6 * 1024 * 1024)]),
    });
    await page
      .getByLabel("Drawing instructions")
      .fill("Restart project: 120 × 80 mm plate");
    await page
      .getByRole("button", { name: "Send drawing instruction" })
      .click();
    await expect(
      page.getByRole("button", { name: "New Drawing", exact: true }),
    ).toBeEnabled({ timeout: 10_000 });
    await expect(
      page
        .frameLocator('iframe[title="Technical drawing preview"]')
        .locator("#hole-top-left"),
    ).toHaveAttribute("r", "6");
    await page
      .getByLabel("Drawing instructions")
      .fill("Keep this unsent draft");
    await page
      .getByRole("button", { name: "Drawing layers", exact: true })
      .click();
    await page.getByLabel("Show dimensions").uncheck();
    await page.keyboard.press("Escape");
    await waitForProjectSave(page);
    const projectData = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open("draftline-projects", 1);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      try {
        return await new Promise<string>((resolve, reject) => {
          const req = db
            .transaction("projects")
            .objectStore("projects")
            .getAll();
          req.onsuccess = () => resolve(JSON.stringify(req.result));
          req.onerror = () => reject(req.error);
        });
      } finally {
        db.close();
      }
    });
    expect(projectData).not.toContain("browser-test-key");
    await context.close();
    context = await playwright.chromium.launchPersistentContext(
      profile,
      options,
    );
    page = await context.newPage();
    await page.goto("/");
    await expect(
      page.getByRole("button", {
        name: "Open drawing Restart project",
        exact: true,
      }),
    ).toHaveAttribute("aria-current", "page");
    await expect(page.locator(".composer-attachment img")).toHaveCount(0);
    await expect(
      page.getByAltText("Reference: large-reference.png"),
    ).toBeVisible();
    await expect(page.getByLabel("Drawing instructions")).toHaveValue(
      "Keep this unsent draft",
    );
    await page
      .getByRole("button", { name: "Drawing layers", exact: true })
      .click();
    await expect(page.getByLabel("Show dimensions")).not.toBeChecked();
    await page.keyboard.press("Escape");
    const frame = page.frameLocator(
      'iframe[title="Technical drawing preview"]',
    );
    await expect(frame.locator("#hole-top-left")).toHaveAttribute("r", "6");
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(
      page.getByText("A fresh page for your next idea."),
    ).toBeVisible();
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await expect(frame.locator("#hole-top-left")).toHaveAttribute("r", "6");
    await page.getByRole("button", { name: "Model settings" }).click();
    await expect(page.getByLabel("API key", { exact: true })).toHaveValue(
      "browser-test-key",
    );
    await page.getByRole("button", { name: "Close model settings" }).click();
    await page
      .getByRole("button", {
        name: "Drawing actions for Restart project",
        exact: true,
      })
      .click();
    await page
      .getByRole("menuitem", {
        name: "Delete drawing Restart project",
        exact: true,
      })
      .click();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(
      page.getByRole("button", {
        name: "Open drawing Restart project",
        exact: true,
      }),
    ).toHaveCount(0);
    for (const name of ["样例1", "样例2", "样例3", "样例4"]) {
      await page
        .getByRole("button", {
          name: `Drawing actions for ${name}`,
          exact: true,
        })
        .click();
      await page
        .getByRole("menuitem", { name: `Delete drawing ${name}`, exact: true })
        .click();
      await page.getByRole("button", { name: "Delete", exact: true }).click();
    }
    await expect(
      page.getByText("A fresh page for your next idea."),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("button", {
        name: "Open drawing Untitled drawing",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByText("A fresh page for your next idea."),
    ).toBeVisible();
    await page.screenshot({
      path: ".generated/draftline-new-drawing.png",
      fullPage: true,
    });
  } finally {
    await context.close();
  }
});

test("storage failures keep the assistant usable and report unsaved work", async ({
  page,
}) => {
  await page.addInitScript(() => {
    IDBFactory.prototype.open = () => {
      throw new DOMException("Storage unavailable", "SecurityError");
    };
  });
  await connectModel(page);
  await page
    .getByLabel("Drawing instructions")
    .fill("Draw a 120 × 80 mm plate");
  await expect(page.getByRole("alert")).toContainText("Browser storage");
  await page.getByRole("button", { name: "Send drawing instruction" }).click();
  await expect(
    page
      .frameLocator('iframe[title="Technical drawing preview"]')
      .locator("#hole-top-left"),
  ).toHaveAttribute("r", "6");
  await expect(page.getByRole("alert")).toContainText("Browser storage");
  await expect(page.getByRole("button", { name: "Export SVG" })).toBeEnabled();
});

test("ordinary chat is visible before the provider completes its stream", async ({
  page,
}) => {
  await connectModel(page);
  await page
    .getByLabel("Drawing instructions")
    .fill("streaming conversation test");
  await page.getByRole("button", { name: "Send drawing instruction" }).click();
  await expect(page.getByText("This plate", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Stop generation" }),
  ).toBeEnabled();
  await expect(
    page
      .frameLocator('iframe[title="Technical drawing preview"]')
      .locator("#hole-top-left"),
  ).toHaveAttribute("r", "5");
  releaseStream();
  await expect(
    page.getByText("This plate has four holes.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send drawing instruction" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Undo", exact: true }),
  ).toBeDisabled();
});

test("received HTML remains plain text until completion and sandbox validation", async ({
  page,
}) => {
  await connectModel(page);
  await page.getByLabel("Drawing instructions").fill("streaming drawing test");
  await page.getByRole("button", { name: "Send drawing instruction" }).click();
  await expect(
    page.getByText("Preparing a revised plate.", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".stream-code pre")).toContainText(
    "setAttribute('r','9')",
  );
  const frame = page.frameLocator('iframe[title="Technical drawing preview"]');
  await expect(frame.locator("#hole-top-left")).toHaveAttribute("r", "5");
  await expect(
    page.locator('iframe[title="Drawing validation sandbox"]'),
  ).toHaveCount(0);
  releaseStream();
  await expect(frame.locator("#hole-top-left")).toHaveAttribute("r", "9");
  await expect(
    page.getByRole("button", { name: "Undo", exact: true }),
  ).toBeEnabled();
  expect(requests.every((request) => request.stream === true)).toBe(true);
});

test("stop generation closes the provider connection and keeps the drawing", async ({
  page,
}) => {
  await connectModel(page);
  await page.getByLabel("Drawing instructions").fill("cancel streaming test");
  await page.getByRole("button", { name: "Send drawing instruction" }).click();
  await expect(
    page.getByText("Working on your update", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Stop generation" }).click();
  await expect(page.getByText("Stopped", { exact: true })).toBeVisible();
  await expect.poll(() => upstreamCancelled).toBe(true);
  await expect(
    page
      .frameLocator('iframe[title="Technical drawing preview"]')
      .locator("#hole-top-left"),
  ).toHaveAttribute("r", "5");
  await expect(
    page.getByRole("button", { name: "Undo", exact: true }),
  ).toBeDisabled();
  await page.reload();
  await expect(page.getByText("Stopped", { exact: true })).toBeVisible();
  await page
    .getByLabel("Drawing instructions")
    .fill("Make the plate 120 mm wide");
  await page.getByRole("button", { name: "Send drawing instruction" }).click();
  await expect(
    page
      .frameLocator('iframe[title="Technical drawing preview"]')
      .locator("#hole-top-left"),
  ).toHaveAttribute("r", "6");
  expect(JSON.stringify(requests.at(-1))).not.toContain(
    "Working on your update",
  );
});

test("a prematurely ended stream shows a connection error without applying partial results", async ({
  page,
}) => {
  await connectModel(page);
  await page
    .getByLabel("Drawing instructions")
    .fill("disconnect streaming test");
  await page.getByRole("button", { name: "Send drawing instruction" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "ended the stream before completion",
  );
  await expect(
    page.getByText("Response incomplete — drawing unchanged", { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .frameLocator('iframe[title="Technical drawing preview"]')
      .locator("#hole-top-left"),
  ).toHaveAttribute("r", "5");
  await expect(
    page.getByRole("button", { name: "Undo", exact: true }),
  ).toBeDisabled();
});

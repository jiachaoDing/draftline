import { test, expect } from "../helpers/workspace-test";
import type { Page } from "@playwright/test";
import { createServer, type Server } from "node:http";
import {
  completeResponse,
  openCompletion,
  contentChunk,
  finishCompletion,
} from "../helpers/provider-stream";
import { EXAMPLE_SVG } from "../../src/lib/example";
import { attachFiles as attach } from "../helpers/attach-files";

let provider: Server;
let baseURL: string;
let requests: any[] = [];
let release = () => {};
test.beforeAll(async () => {
  provider = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const input = JSON.parse(body);
    requests.push(input);
    const instruction = input.messages.at(-1).content[0].text;
    if (
      instruction.includes("retry reference") &&
      requests.filter((request) =>
        request.messages.at(-1).content[0].text.includes("retry reference"),
      ).length === 1
    ) {
      openCompletion(res);
      contentChunk(
        res,
        '{"kind":"message","message":"Partial reference answer"}',
      );
      res.end();
    } else if (instruction.includes("background A")) {
      openCompletion(res);
      contentChunk(
        res,
        JSON.stringify({
          kind: "drawing",
          title: "Background result A",
          summary: "Background A finished.",
          notes: [],
          html: EXAMPLE_SVG.replaceAll('r="5"', 'r="9"'),
        }),
      );
      await new Promise<void>((resolve) => {
        release = resolve;
        res.once("close", resolve);
      });
      if (!res.destroyed) finishCompletion(res);
    } else {
      completeResponse(
        res,
        JSON.stringify({ kind: "message", message: "References received." }),
      );
    }
  });
  await new Promise<void>((resolve) =>
    provider.listen(0, "127.0.0.1", resolve),
  );
  baseURL = `http://127.0.0.1:${(provider.address() as { port: number }).port}/v1`;
});

test("retry uses the original instruction and attachments without adding a second user message", async ({
  page,
}) => {
  await open(page);
  await page
    .frameLocator('iframe[title="Technical drawing preview"]')
    .locator("#hole-top-left")
    .click();
  await attach(page, {
    name: "retry.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Reference for retry"),
  });
  await expect(page.getByText("Reading attachment…")).toHaveCount(0);
  await page.getByLabel("Drawing instructions").fill("retry reference");
  await page.getByRole("button", { name: "Send drawing instruction" }).click();
  await expect(
    page.getByText("Response incomplete — drawing unchanged", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Retry response" }).click();
  await expect(
    page.getByText("References received.", { exact: true }),
  ).toBeVisible();
  expect(requests).toHaveLength(2);
  expect(JSON.stringify(requests[1].messages.at(-1))).toContain(
    "Selected element: hole-top-left",
  );
  expect(requests[1].messages.at(-1)).toEqual(requests[0].messages.at(-1));
  await expect(page.locator(".chat-message.user")).toHaveCount(1);
  await expect(page.locator(".composer-attachment")).toHaveCount(0);
});
test.afterAll(
  () => new Promise<void>((resolve) => provider.close(() => resolve())),
);
test.afterEach(() => release());
async function open(page: Page) {
  requests = [];
  await page.addInitScript((url) => {
    if (window !== window.top) return;
    localStorage.setItem(
      "draftline-model",
      JSON.stringify({
        baseURL: url,
        apiKey: "workspace-test",
        model: "vision-test",
      }),
    );
  }, baseURL);
  await page.goto("/");
  await expect(page.locator(".canvas-status")).not.toContainText(
    "0 geometry elements",
  );
}

test("IME confirmation preserves the draft and Enter sends the committed text exactly once", async ({
  page,
}) => {
  await open(page);
  const input = page.getByLabel("Drawing instructions");
  await input.focus();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.imeSetComposition", {
    text: "ni hao",
    selectionStart: 6,
    selectionEnd: 6,
  });
  await input.dispatchEvent("keydown", {
    key: "Enter",
    isComposing: true,
    keyCode: 229,
  });
  expect(requests).toHaveLength(0);
  await cdp.send("Input.insertText", { text: "你好" });
  await expect(input).toHaveValue("你好");
  await input.dispatchEvent("keydown", {
    key: "Enter",
    isComposing: false,
    keyCode: 229,
  });
  expect(requests).toHaveLength(0);
  await page.keyboard.press("Enter");
  await expect(
    page.getByText("References received.", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".chat-message.user")).toHaveCount(1);
  await expect(page.locator(".chat-message.user .message-text")).toHaveText(
    "你好",
  );
  expect(requests).toHaveLength(1);
  await expect(input).toHaveValue("");
});
test("background validation commits to its original drawing while another drawing stays editable", async ({
  page,
}) => {
  await open(page);
  await page.getByLabel("Drawing instructions").fill("background A");
  await page.getByRole("button", { name: "Send drawing instruction" }).click();
  await expect(
    page.getByText("Background A finished.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect(page.locator(".zoom-controls")).not.toContainText("100%");
  await page.getByRole("button", { name: "Pan tool", exact: true }).click();
  const frame = page.frameLocator('iframe[title="Technical drawing preview"]');
  await expect(frame.locator("body")).toHaveAttribute("data-mode", "pan");
  await page.getByRole("button", { name: "Code", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Apply code", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "New Drawing", exact: true }).click();
  await page.evaluate(() => {
    const events: unknown[] = [];
    Object.assign(window, { validationEvents: events });
    window.addEventListener("message", (event) => {
      if (!event.data?.channel) return;
      events.push({
        kind: event.data.type,
        sourceIsValidation:
          event.source ===
          document.querySelector<HTMLIFrameElement>(
            ".validation-preview iframe",
          )?.contentWindow,
      });
    });
    document.addEventListener(
      "load",
      (event) => {
        if (event.target instanceof HTMLIFrameElement)
          events.push({
            kind: "frame-load",
            connected: event.target.isConnected,
            length: event.target.srcdoc.length,
          });
      },
      true,
    );
  });
  await page.getByRole("button", { name: "Code", exact: true }).click();
  await page
    .getByLabel("Drawing source code")
    .fill(EXAMPLE_SVG.replaceAll('r="5"', 'r="8"'));
  await page.getByRole("button", { name: "Apply code", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Stop generation" }),
  ).toHaveCount(0, { timeout: 10000 });
  try {
    expect(await page.getByRole("alert").allTextContents()).toEqual([]);
  } catch (error) {
    await test.info().attach("validation-events", {
      body: JSON.stringify(
        await page.evaluate(() => ({
          events: (window as unknown as { validationEvents: unknown[] })
            .validationEvents,
          frames: [
            ...document.querySelectorAll(".validation-preview iframe"),
          ].map((frame) => ({
            connected: frame.isConnected,
            length: (frame as HTMLIFrameElement).srcdoc.length,
          })),
          alerts: [...document.querySelectorAll('[role="alert"]')].map(
            (alert) => alert.textContent,
          ),
        })),
      ),
      contentType: "application/json",
    });
    throw error;
  }
  await expect(frame.locator("#hole-top-left")).toHaveAttribute("r", "8", {
    timeout: 10000,
  });
  await page.getByLabel("Drawing instructions").fill("Unsent B draft");
  release();
  await expect(
    page.getByRole("button", {
      name: "Open drawing Background result A",
      exact: true,
    }),
  ).toBeVisible();
  await expect(frame.locator("#hole-top-left")).toHaveAttribute("r", "8");
  await expect(page.getByLabel("Drawing instructions")).toHaveValue(
    "Unsent B draft",
  );
  await page
    .getByRole("button", {
      name: "Open drawing Background result A",
      exact: true,
    })
    .click();
  await expect(frame.locator("#hole-top-left")).toHaveAttribute("r", "9");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(frame.locator("#hole-top-left")).toHaveAttribute("r", "5");
  await page
    .getByRole("button", { name: "Open drawing Untitled drawing", exact: true })
    .click();
  await expect(frame.locator("#hole-top-left")).toHaveAttribute("r", "8");
  await expect(page.getByLabel("Drawing instructions")).toHaveValue(
    "Unsent B draft",
  );
  await page.reload();
  await expect(frame.locator("#hole-top-left")).toHaveAttribute("r", "8");
});

test("assistant-ui attaches multiple formats once and persists attachments on their messages", async ({
  page,
}) => {
  await open(page);
  await attach(page, [
    {
      name: "reference.svg",
      mimeType: "image/svg+xml",
      buffer: Buffer.from(
        '<svg width="40mm" height="30mm"><rect width="40" height="30"/></svg>',
      ),
    },
    {
      name: "part.dxf",
      mimeType: "application/dxf",
      buffer: Buffer.from("0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF"),
    },
    {
      name: "notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Dimensions: 40 x 30 mm."),
    },
    {
      name: "sheet.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\nReference fixture"),
    },
    {
      name: "image.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=",
        "base64",
      ),
    },
  ]);
  await expect(page.locator(".composer-attachment")).toHaveCount(5);
  await expect(page.getByText("Reading attachment…")).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".composer-attachment")).toHaveCount(5);
  await page.getByLabel("Drawing instructions").fill("Read these references");
  await page.getByRole("button", { name: "Send drawing instruction" }).click();
  await expect(
    page.getByText("References received.", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".composer-attachment")).toHaveCount(0);
  await expect(
    page.locator(".chat-message.user .message-reference"),
  ).toHaveCount(5);
  const parts = requests[0].messages.at(-1).content;
  expect(
    parts.some(
      (part: any) => part.type === "file" || part.type === "image_url",
    ),
  ).toBe(false);
  expect(JSON.stringify(parts)).not.toContain("Dimensions: 40 x 30 mm.");
  expect(JSON.stringify(parts)).not.toContain("ENTITIES");
  expect(JSON.stringify(parts)).toContain("sheet.pdf");
  await page.getByLabel("Drawing instructions").fill("A fresh message");
  await page.getByRole("button", { name: "Send drawing instruction" }).click();
  await expect(
    page.getByText("References received.", { exact: true }),
  ).toHaveCount(2);
  const fresh = requests[1].messages.at(-1).content;
  expect(
    fresh.some(
      (part: any) => part.type === "image_url" || part.type === "file",
    ),
  ).toBe(false);
  expect(JSON.stringify(fresh)).not.toContain("ENTITIES");
  expect(JSON.stringify(fresh)).toContain("reference.svg");
  await page.reload();
  await expect(
    page.locator(".chat-message.user .message-reference"),
  ).toHaveCount(5);
  await expect(page.locator(".composer-attachment")).toHaveCount(0);
});

test("floating objects panel toggles, resizes, scrolls and follows canvas selection", async ({
  page,
}) => {
  await open(page);
  for (let unchangedApply = 0; unchangedApply < 2; unchangedApply++) {
    await page.getByRole("button", { name: "Code", exact: true }).click();
    await page.getByRole("button", { name: "Apply code", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Stop generation" }),
    ).toHaveCount(0);
  }
  const panel = page.getByRole("region", {
    name: "Drawing objects",
    exact: true,
  });
  await expect(panel).toHaveCount(0);
  await expect(page.locator(".assistant-panel .selection-panel")).toHaveCount(
    0,
  );
  await page
    .getByRole("button", { name: "Objects and groups", exact: true })
    .click();
  await expect(panel).toBeVisible();
  const bounds = (await panel.boundingBox())!;
  await page.mouse.move(
    bounds.x + bounds.width - 12,
    bounds.y + bounds.height - 12,
  );
  await panel.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + bounds.width + 60,
    bounds.y + bounds.height + 50,
    { steps: 8 },
  );
  await page.mouse.up();
  expect((await panel.boundingBox())!.width).toBeGreaterThan(bounds.width + 20);
  const frame = page.frameLocator('iframe[title="Technical drawing preview"]');
  // Keep the floating panel clear of the click target by using the object tree first.
  await panel
    .locator(".object-tree-row")
    .filter({ hasText: "Top right hole" })
    .click();
  await expect(frame.locator("#hole-top-right")).toHaveAttribute(
    "data-selected",
    "true",
  );
  await expect(page.locator(".composer-selection")).toContainText("1 selected");
  await page.getByRole("button", { name: "Close objects panel" }).click();
  await frame.locator("#hole-bottom-right").click();
  await page
    .getByRole("button", { name: "Objects and groups", exact: true })
    .click();
  await expect(panel.locator('[aria-pressed="true"]')).toContainText(
    "Bottom right hole",
  );
  const visible = await panel
    .locator('[aria-pressed="true"]')
    .evaluate((row) => {
      const parent = row.closest("section")!.querySelector(":scope > ul")!;
      const a = row.getBoundingClientRect(),
        b = parent.getBoundingClientRect();
      return a.top >= b.top && a.bottom <= b.bottom;
    });
  expect(visible).toBe(true);
  await page
    .getByRole("button", { name: "Clear AI selection context" })
    .click();
  await expect(frame.locator("[data-selected]")).toHaveCount(0);
  await expect(page.locator(".composer-selection")).toHaveCount(0);
  await expect(page.locator(".canvas-selection")).toHaveCount(0);
  expect(await page.evaluate(() => [scrollX, scrollY])).toEqual([0, 0]);
});

test("manual chat scrolling stays in place when a streamed reply completes", async ({
  page,
}) => {
  await open(page);
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open("draftline-projects", 1);
      request.onsuccess = () => resolve(request.result);
    });
    const transaction = db.transaction("projects", "readwrite");
    const store = transaction.objectStore("projects");
    const request = store.getAll();
    request.onsuccess = () => {
      const project = request.result[0];
      project.messages = Array.from({ length: 40 }, (_, index) => ({
        id: `history-${index}`,
        role: index % 2 ? "assistant" : "user",
        text: `Earlier drawing discussion ${index}. `.repeat(10),
        status: "complete",
      }));
      store.put(project);
    };
    await new Promise<void>((resolve) => {
      transaction.oncomplete = () => resolve();
    });
    db.close();
  });
  await page.reload();
  await page.getByLabel("Drawing instructions").fill("background A");
  await page.getByRole("button", { name: "Send drawing instruction" }).click();
  await expect(
    page.getByText("Background A finished.", { exact: true }),
  ).toBeVisible();
  const history = page.locator(".assistant-content");
  const bounds = (await history.boundingBox())!;
  await page.mouse.move(bounds.x + 3, bounds.y + bounds.height / 2);
  await page.mouse.wheel(0, -20000);
  await expect
    .poll(() => history.evaluate((element) => element.scrollTop))
    .toBe(0);
  release();
  await expect(
    page.getByRole("button", { name: "Send drawing instruction" }),
  ).toBeVisible();
  await expect
    .poll(() => history.evaluate((element) => element.scrollTop))
    .toBe(0);
  await page.getByRole("button", { name: "Scroll to latest message" }).click();
  await expect
    .poll(() => history.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  expect(await page.evaluate(() => [scrollX, scrollY])).toEqual([0, 0]);
});

test("composer supports dropping and pasting multiple files and removing individual attachments", async ({
  page,
}) => {
  await open(page);
  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["40 mm"], "drop.txt", { type: "text/plain" }));
    transfer.items.add(
      new File(["<svg/>"], "drop.svg", { type: "image/svg+xml" }),
    );
    const target = document.querySelector(".composer-dropzone")!;
    target.dispatchEvent(
      new DragEvent("dragenter", { dataTransfer: transfer, bubbles: true }),
    );
    target.dispatchEvent(
      new DragEvent("drop", { dataTransfer: transfer, bubbles: true }),
    );
  });
  await expect(page.locator(".composer-attachment")).toHaveCount(2);
  await page
    .getByRole("button", { name: "Remove attachment drop.svg" })
    .click();
  await page.getByLabel("Drawing instructions").evaluate((input) => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File(["20 mm"], "paste.txt", { type: "text/plain" }),
    );
    transfer.items.add(
      new File(["10 mm"], "paste.md", { type: "text/markdown" }),
    );
    input.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true }),
    );
  });
  await expect(page.locator(".composer-attachment")).toHaveCount(3);
  await expect(page.getByText("Reading attachment…")).toHaveCount(0);
  await expect(page.locator(".composer-attachments")).toContainText("drop.txt");
  await expect(page.locator(".composer-attachments")).not.toContainText(
    "drop.svg",
  );
  await page
    .getByLabel("Drawing instructions")
    .fill("Check dropped and pasted files");
  await page.getByRole("button", { name: "Send drawing instruction" }).click();
  await expect(
    page.getByText("References received.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".chat-message.user .message-reference"),
  ).toHaveCount(3);
});

test("model connection preserves the unsent instruction and references", async ({
  page,
}) => {
  await page.goto("/");
  await attach(page, {
    name: "draft.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("40 mm"),
  });
  await expect(page.getByText("Reading attachment…")).toHaveCount(0);
  await page
    .getByLabel("Drawing instructions")
    .fill("Keep this instruction while connecting");
  await page.getByRole("button", { name: "Send drawing instruction" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Close model settings" }).click();
  await expect(page.getByLabel("Drawing instructions")).toHaveValue(
    "Keep this instruction while connecting",
  );
  await expect(page.locator(".composer-attachment")).toHaveCount(1);
  await expect(page.locator(".chat-message.user")).toHaveCount(0);
});

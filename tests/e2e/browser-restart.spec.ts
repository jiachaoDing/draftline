import { test, expect } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { completeResponse } from "../helpers/provider-stream";
import { waitForProjectSave } from "../helpers/project-storage";
import { attachFiles } from "../helpers/attach-files";
import { EXAMPLE_SVG } from "../../src/lib/example";

let provider: Server;
let baseURL: string;
test.beforeAll(async () => {
  provider = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    if (request.headers.authorization !== "Bearer browser-test-key") {
      response.writeHead(401);
      response.end("{}");
      return;
    }
    if (request.url === "/v1/models") {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ data: [{ id: "vision-test" }] }));
      return;
    }
    JSON.parse(body);
    completeResponse(
      response,
      JSON.stringify({
        kind: "drawing",
        title: "Generated test plate",
        summary: "Generated the plate with a Ø12 top-left hole.",
        notes: [],
        html: `${EXAMPLE_SVG}<script>document.getElementById('hole-top-left').setAttribute('r','6')</script>`,
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

async function connectModel(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Model settings" }).click();
  await page.getByLabel("Base URL", { exact: true }).fill(baseURL);
  await page.getByLabel("API key", { exact: true }).fill("browser-test-key");
  await page.getByLabel("Model", { exact: true }).fill("vision-test");
  await page.getByRole("button", { name: "Save settings" }).click();
}

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

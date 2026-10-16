import { test, expect, type Page } from "@playwright/test";

async function expectViewportLayout(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const { innerWidth: width, innerHeight: height } = window;
        const app = document.querySelector(".app")!.getBoundingClientRect();
        const panels = [
          ".header-actions",
          ".canvas-toolbar",
          ".drawing-workspace",
          ".assistant-panel",
          ".assistant-controls",
        ];
        return {
          appFits:
            app.x === 0 &&
            app.y === 0 &&
            app.width === width &&
            app.height === height,
          rootFits: [
            document.documentElement,
            document.body,
            document.getElementById("root")!,
          ].every(
            (element) =>
              element.scrollWidth <= width && element.scrollHeight <= height,
          ),
          panelsFit: panels.every((selector) => {
            const bounds = document
              .querySelector(selector)!
              .getBoundingClientRect();
            return (
              bounds.width > 0 &&
              bounds.height > 0 &&
              bounds.x >= 0 &&
              bounds.y >= 0 &&
              bounds.right <= width + 1 &&
              bounds.bottom <= height + 1
            );
          }),
          pagePosition: [window.scrollX, window.scrollY],
        };
      }),
    )
    .toEqual({
      appFits: true,
      rootFits: true,
      panelsFit: true,
      pagePosition: [0, 0],
    });
}

test("workspace remains inside the viewport across desktop, tablet, mobile and short windows", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Collapse sidebar" }),
  ).toBeVisible();
  for (const [width, height] of [
    [1440, 900],
    [1280, 600],
    [1050, 700],
    [900, 650],
    [701, 600],
    [700, 600],
    [390, 844],
    [360, 640],
    [320, 568],
    [844, 390],
    [1920, 1080],
  ]) {
    await page.setViewportSize({ width, height });
    await expectViewportLayout(page);
    await page.getByRole("button", { name: "Code", exact: true }).click();
    await expect(page.getByLabel("Drawing source code")).toBeVisible();
    await expectViewportLayout(page);
    await page.getByRole("button", { name: "Drawing", exact: true }).click();
    await expect(
      page
        .frameLocator('iframe[title="Technical drawing preview"]')
        .locator("#plate-outline"),
    ).toBeVisible();
    const send = page.getByRole("button", {
      name: "Send drawing instruction",
      exact: true,
    });
    await send.scrollIntoViewIfNeeded();
    await expect(send).toBeInViewport();
    if (height <= 400)
      expect(
        await page
          .locator(".assistant-controls")
          .evaluate((element) => element.scrollTop),
      ).toBeGreaterThan(0);
    await page.evaluate(() => window.scrollTo(1000, 1000));
    await expectViewportLayout(page);
  }
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expectViewportLayout(page);
  await page.getByRole("button", { name: "Expand sidebar" }).click();
  await expectViewportLayout(page);
});

test("long drawing lists and chat history scroll internally without moving the page", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".saved-indicator")).toHaveText("Saved locally");
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("draftline-projects", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const transaction = db.transaction("projects", "readwrite");
      const store = transaction.objectStore("projects");
      const request = store.getAll();
      request.onsuccess = () => {
        const project = request.result[0];
        project.messages = Array.from({ length: 60 }, (_, index) => ({
          role: index % 2 ? "assistant" : "user",
          text: `Message ${index}: ${"Detailed drawing discussion. ".repeat(12)}`,
        }));
        store.put(project);
        for (let index = 0; index < 40; index++)
          store.put({
            ...project,
            id: `viewport-${index}`,
            name: `Viewport drawing ${index}`,
          });
      };
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
    } finally {
      db.close();
    }
  });
  await page.reload();
  for (const [width, height] of [
    [1440, 650],
    [900, 650],
    [390, 700],
  ]) {
    await page.setViewportSize({ width, height });
    const history = page.locator(".assistant-content");
    await expect
      .poll(() =>
        history.evaluate(
          (element) =>
            element.scrollHeight > element.clientHeight &&
            element.clientHeight > 0,
        ),
      )
      .toBe(true);
    await history.evaluate((element) =>
      element.scrollTo({ top: 0, behavior: "instant" }),
    );
    await history.hover();
    await page.mouse.wheel(0, 300);
    await expect
      .poll(() => history.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);
    await expectViewportLayout(page);
    if (width <= 700)
      await page.getByRole("button", { name: "Expand sidebar" }).click();
    const last = page.getByRole("button", {
      name: "Open drawing Viewport drawing 39",
      exact: true,
    });
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport();
    await expect
      .poll(() =>
        page
          .locator(".drawings-scroll")
          .evaluate((element) => element.scrollTop),
      )
      .toBeGreaterThan(0);
    if (width <= 700)
      await page
        .getByRole("button", { name: "Close sidebar", exact: true })
        .click();
    await expectViewportLayout(page);
  }
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect(page.locator(".zoom-controls")).not.toContainText("100%");
  const zoom = await page.locator(".zoom-controls").innerText();
  await page
    .frameLocator('iframe[title="Technical drawing preview"]')
    .locator("svg")
    .hover();
  await page.mouse.wheel(0, -200);
  await expect(page.locator(".zoom-controls")).not.toHaveText(zoom);
  await page.getByRole("button", { name: "Pan tool", exact: true }).click();
  await expect(
    page
      .frameLocator('iframe[title="Technical drawing preview"]')
      .locator("body"),
  ).toHaveAttribute("data-mode", "pan");
  await expectViewportLayout(page);
  await page.screenshot({ path: ".generated/viewport-mobile.png" });
});

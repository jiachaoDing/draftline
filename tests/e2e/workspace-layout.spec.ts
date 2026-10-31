import { test, expect } from "../helpers/workspace-test";

test("mobile work areas preserve canvas, draft and desktop preferences", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const frame = page.frameLocator('iframe[title="Technical drawing preview"]');
  await expect(frame.locator("#plate-outline")).toBeVisible();
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect(page.locator(".zoom-controls")).not.toContainText("100%");
  const zoom = await page.locator(".zoom-controls").innerText();
  const settings = await page.evaluate(() =>
    localStorage.getItem("draftline-workspace-layout"),
  );
  await page.screenshot({ path: ".generated/layout-mobile-canvas.png" });
  await page.getByRole("button", { name: "AI assistant", exact: true }).click();
  const input = page.getByLabel("Drawing instructions", { exact: true });
  await input.fill("Keep this mobile draft");
  await expect(
    page.getByRole("button", { name: "Fit drawing", exact: true }),
  ).toBeHidden();
  await page.screenshot({ path: ".generated/layout-mobile-assistant.png" });
  await page.getByRole("button", { name: "Canvas", exact: true }).click();
  await expect(page.locator(".zoom-controls")).toHaveText(zoom);
  await expect(frame.locator("#plate-outline")).toBeVisible();
  await page.getByRole("button", { name: "AI assistant", exact: true }).click();
  await expect(input).toHaveValue("Keep this mobile draft");
  expect(
    await page.evaluate(() =>
      localStorage.getItem("draftline-workspace-layout"),
    ),
  ).toBe(settings);
  await page
    .getByRole("button", { name: "Expand sidebar", exact: true })
    .click();
  await page.setViewportSize({ width: 390, height: 500 });
  await expect(
    page.getByRole("dialog", { name: "Drawing navigation" }),
  ).toBeVisible();
});

test("panel resizing, independent collapse and refresh preserve workspace preferences and view", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const frame = page.frameLocator('iframe[title="Technical drawing preview"]');
  await expect(frame.locator("#plate-outline")).toBeVisible();
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  // The bridge and svg-pan-zoom publish the new CTM on the next paint.
  await expect(page.locator(".zoom-controls")).not.toContainText("100%");
  await frame
    .locator("svg")
    .evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
  const transform = await frame
    .locator(".svg-pan-zoom_viewport")
    .getAttribute("transform");
  const zoom = await page.locator(".zoom-controls").innerText();
  const left = page.getByRole("separator", { name: "Resize drawing panel" });
  const right = page.getByRole("separator", {
    name: "Resize conversation panel",
  });
  await left.focus();
  await left.press("ArrowRight");
  await expect(left).toHaveAttribute("aria-valuenow", "260");
  const bounds = (await right.boundingBox())!;
  const panelBefore = (await page.locator(".assistant-panel").boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 100);
  await page.mouse.down();
  await page.mouse.move(bounds.x - 64, bounds.y + 100, { steps: 10 });
  await page.mouse.up();
  await expect
    .poll(async () => Number(await right.getAttribute("aria-valuenow")))
    .toBeGreaterThan(410);
  const savedWidth = await right.getAttribute("aria-valuenow");
  const panelAfter = (await page.locator(".assistant-panel").boundingBox())!;
  expect(panelAfter.x).toBeLessThan(panelBefore.x - 50);
  expect(panelAfter.x + panelAfter.width).toBeCloseTo(
    panelBefore.x + panelBefore.width,
    0,
  );
  await expect(page.locator(".zoom-controls")).toHaveText(zoom);
  await expect(frame.locator(".svg-pan-zoom_viewport")).toHaveAttribute(
    "transform",
    transform!,
  );
  const toggleBefore = (await page
    .locator(".conversation-toggle")
    .boundingBox())!;
  expect(
    panelAfter.x + panelAfter.width - toggleBefore.x - toggleBefore.width,
  ).toBe(8);
  await page
    .getByRole("button", { name: "Collapse conversation", exact: true })
    .click();
  await expect(page.locator(".conversation-toggle")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  expect(await page.locator(".conversation-toggle").boundingBox()).toEqual(
    toggleBefore,
  );
  await expect(page.locator(".assistant-panel")).toBeHidden();
  await expect(frame.locator(".svg-pan-zoom_viewport")).toHaveAttribute(
    "transform",
    transform!,
  );
  await page
    .getByRole("button", { name: "Collapse sidebar", exact: true })
    .click();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Expand sidebar", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Expand conversation", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Expand conversation", exact: true })
    .click();
  await expect(right).toHaveAttribute("aria-valuenow", savedWidth!);
  await page
    .getByRole("button", { name: "Expand sidebar", exact: true })
    .click();
  await expect(left).toHaveAttribute("aria-valuenow", "260");
  await expect(page.locator(".canvas")).toHaveCSS("background-image", "none");
  await page.setViewportSize({ width: 1100, height: 650 });
  await expect
    .poll(() =>
      page
        .locator(".drawing-workspace")
        .evaluate((element) => element.clientWidth),
    )
    .toBeGreaterThanOrEqual(360);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(right).toHaveAttribute("aria-valuenow", savedWidth!);
  await page.getByRole("button", { name: "Fit drawing", exact: true }).click();
  await page.screenshot({ path: ".generated/workspace-redesign.png" });
});

test("invalid layout storage falls back and mobile navigation preserves desktop collapse", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("draftline-workspace-layout", "invalid"),
  );
  await page.goto("/");
  await expect(
    page.getByRole("separator", { name: "Resize drawing panel" }),
  ).toHaveAttribute("aria-valuenow", "244");
  await page
    .getByRole("button", { name: "Collapse sidebar", exact: true })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Expand sidebar", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Drawing navigation", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Close sidebar", exact: true })
    .click();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(
    page.getByRole("button", { name: "Expand sidebar", exact: true }),
  ).toBeVisible();
});

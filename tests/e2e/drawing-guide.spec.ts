import { test, expect } from "../helpers/workspace-test";
import { attachFiles } from "../helpers/attach-files";
import { waitForProjectSave } from "../helpers/project-storage";

test("handbook navigation and dismissal preserve the draft, attachment and drawing", async ({
  page,
}) => {
  let drawingRequests = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/api/draw")) drawingRequests++;
  });
  await page.goto("/");
  const frame = page.frameLocator('iframe[title="Technical drawing preview"]');
  await expect(frame.locator("body")).toHaveAttribute(
    "data-interaction",
    "select-pan",
  );
  await frame.locator("#hole-top-left").click();
  await expect(page.locator(".composer-selection")).toContainText("1 selected");
  const input = page.getByLabel("Drawing instructions", { exact: true });
  await input.fill("Keep my unsent drawing instruction 保留草稿");
  await attachFiles(page, {
    name: "measurements.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Width 140 mm; height 180 mm."),
  });
  await expect(page.getByText("Reading attachment…")).toHaveCount(0);
  const trigger = page.getByRole("button", {
    name: "Drawing examples",
    exact: true,
  });
  const triggerBox = (await trigger.boundingBox())!;
  const inputBox = (await input.boundingBox())!;
  expect(triggerBox.y + triggerBox.height).toBeLessThanOrEqual(inputBox.y);
  expect(
    Math.abs(triggerBox.x + triggerBox.width - inputBox.x - inputBox.width),
  ).toBeLessThan(24);
  await trigger.focus();
  await trigger.press("Enter");
  const book = page.getByRole("dialog", {
    name: "Drawing examples",
    exact: true,
  });
  const close = book.getByRole("button", { name: "Close drawing examples" });
  await expect(close).toBeFocused();
  await close.press("Shift+Tab");
  expect(
    await book.evaluate((element) => element.contains(document.activeElement)),
  ).toBe(true);
  await expect(book.getByRole("img")).toHaveCount(17);
  await page.screenshot({ path: ".generated/drawing-guide-desktop.png" });
  const contents = book.getByRole("navigation", { name: "Handbook contents" });
  await contents
    .getByRole("button", { name: "Triangular notch", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(
    book.getByRole("heading", { name: "Triangular notch", exact: true }),
  ).toBeInViewport();
  await expect(
    book
      .getByRole("img", { name: "Triangular notch", exact: true })
      .getByText("Opening 2 · Depth 3"),
  ).toBeVisible();
  await page.screenshot({
    path: ".generated/drawing-guide-triangular-notch.png",
  });
  expect(
    await book
      .locator(".drawing-guide-pages")
      .evaluate((element) => element.scrollTop),
  ).toBeGreaterThan(0);
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Escape");
  await expect(book).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(
    book.getByRole("heading", {
      name: "Rectangle, width and height",
      exact: true,
    }),
  ).toBeInViewport();
  expect(
    await book
      .locator(".drawing-guide-pages")
      .evaluate((element) => element.scrollTop),
  ).toBe(0);
  await close.click();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.mouse.click(3, 3);
  await expect(book).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(input).toHaveValue(
    "Keep my unsent drawing instruction 保留草稿",
  );
  await expect(page.locator(".composer-attachment")).toContainText(
    "measurements.txt",
  );
  await expect(
    page
      .frameLocator('iframe[title="Technical drawing preview"]')
      .locator("#plate-outline"),
  ).toHaveAttribute("width", "120");
  expect(drawingRequests).toBe(0);
  await expect(page.locator(".composer-selection")).toContainText("1 selected");
  await waitForProjectSave(page);
  await page.reload();
  await expect(input).toHaveValue(
    "Keep my unsent drawing instruction 保留草稿",
  );
  await expect(page.locator(".composer-attachment")).toContainText(
    "measurements.txt",
  );
  await expect(book).toHaveCount(0);
});

test("unread badge clears on opening and stays read across projects and refresh", async ({
  page,
}) => {
  await page.goto("/");
  const trigger = page.getByRole("button", {
    name: "Drawing examples",
    exact: true,
  });
  const badge = trigger.locator(".drawing-guide-badge");
  await expect(badge).toHaveText("1");
  await expect(trigger).toHaveAccessibleDescription(
    "New drawing handbook. Open to read the examples.",
  );
  await page.screenshot({ path: ".generated/drawing-guide-unread.png" });
  await page.reload();
  await expect(badge).toHaveText("1");
  await trigger.click();
  await expect(
    page.getByRole("dialog", { name: "Drawing examples", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(badge).toHaveCount(0);
  await page.getByRole("button", { name: "New Drawing", exact: true }).click();
  await expect(badge).toHaveCount(0);
  await page.reload();
  await expect(trigger).toBeVisible();
  await expect(badge).toHaveCount(0);
});

test("unavailable badge storage preserves reading and acknowledgement across project changes", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const get = Storage.prototype.getItem;
    const set = Storage.prototype.setItem;
    Storage.prototype.getItem = function (key) {
      if (key === "draftline-drawing-guide-seen")
        throw new DOMException("Unavailable", "SecurityError");
      return get.call(this, key);
    };
    Storage.prototype.setItem = function (key, value) {
      if (key === "draftline-drawing-guide-seen")
        throw new DOMException("Unavailable", "SecurityError");
      return set.call(this, key, value);
    };
  });
  await page.goto("/");
  const trigger = page.getByRole("button", {
    name: "Drawing examples",
    exact: true,
  });
  await expect(trigger.locator(".drawing-guide-badge")).toHaveText("1");
  await trigger.click();
  const book = page.getByRole("dialog", {
    name: "Drawing examples",
    exact: true,
  });
  await expect(book).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "New Drawing", exact: true }).click();
  await expect(trigger.locator(".drawing-guide-badge")).toHaveCount(0);
  await trigger.click();
  await expect(book).toBeVisible();
});

test("common geometry follows positioning and illustrates arch span and rise accurately", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Drawing examples", exact: true })
    .click();
  const book = page.getByRole("dialog", {
    name: "Drawing examples",
    exact: true,
  });
  expect(
    await book.locator(".drawing-guide-chapter > h2").allTextContents(),
  ).toEqual([
    expect.stringContaining("Shape and size"),
    expect.stringContaining("Position and arrangement"),
    expect.stringContaining("Common geometric structures"),
  ]);
  const contents = book.getByRole("navigation", { name: "Handbook contents" });
  for (const [name, rise, overall] of [
    ["Semicircular arched top", 5, 9],
    ["Semi-elliptical arched top", 3, 7],
  ] as const) {
    await contents.getByRole("button", { name, exact: true }).click();
    const heading = book.getByRole("heading", { name, exact: true });
    await expect(heading).toBeInViewport();
    const section = heading.locator("..");
    const diagram = section.getByRole("img", { name, exact: true });
    await expect(diagram.getByText("Span 10", { exact: true })).toBeVisible();
    await expect(
      diagram.getByText(`Rise ${rise}`, { exact: true }),
    ).toBeVisible();
    await expect(section.getByRole("blockquote")).toContainText(
      `overall height is ${overall} mm`,
    );
    const proportions = await diagram.evaluate((svg) => {
      const outline = svg
        .querySelector<SVGGraphicsElement>(".guide-outline path")!
        .getBBox();
      const arc = svg
        .querySelector<SVGGraphicsElement>(".guide-accent")!
        .getBBox();
      return {
        overall: outline.height / outline.width,
        rise: arc.height / arc.width,
      };
    });
    expect(proportions.overall).toBeCloseTo(overall / 10);
    expect(proportions.rise).toBeCloseTo(rise / 10);
  }
  await page.screenshot({ path: ".generated/drawing-guide-arched-top.png" });
});

for (const language of ["en", "zh-CN"] as const) {
  test.describe(language, () => {
    test.use({ workspaceLanguage: language });
    test("handbook and translated SVG labels fit desktop, mobile and short viewports", async ({
      page,
    }) => {
      const chinese = language === "zh-CN";
      await page.goto("/");
      for (const [width, height] of [
        [1440, 900],
        [390, 844],
        [390, 500],
        [320, 500],
      ]) {
        await page.setViewportSize({ width, height });
        if (width < 700) {
          await page
            .locator(".mobile-navigation")
            .getByRole("button", {
              name: chinese ? "AI 助手" : "AI assistant",
              exact: true,
            })
            .click();
        }
        await page
          .getByRole("button", {
            name: chinese ? "绘图图例" : "Drawing examples",
            exact: true,
          })
          .click();
        const book = page.getByRole("dialog", {
          name: chinese ? "绘图图例" : "Drawing examples",
          exact: true,
        });
        await expect(book.getByRole("img")).toHaveCount(17);
        await expect(
          book
            .getByRole("img")
            .first()
            .getByText(chinese ? "总宽 140" : "Width 140"),
        ).toHaveCount(1);
        const bounds = (await book
          .locator(".drawing-guide-book")
          .boundingBox())!;
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.y).toBeGreaterThanOrEqual(0);
        expect(bounds.width).toBeLessThanOrEqual(Math.min(960, width));
        expect(bounds.height).toBeLessThanOrEqual(height * 0.85 + 1);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
        expect(bounds.y + bounds.height).toBeLessThanOrEqual(height);
        expect(
          await book
            .locator(".drawing-guide-book")
            .evaluate((element) => element.scrollWidth <= element.clientWidth),
        ).toBe(true);
        const nav = book.getByRole("navigation", {
          name: chinese ? "手册目录" : "Handbook contents",
        });
        await nav
          .getByRole("button", {
            name: chinese ? "等距排列" : "Equal spacing",
            exact: true,
          })
          .click();
        await expect(
          book.getByRole("heading", {
            name: chinese ? "等距排列" : "Equal spacing",
            exact: true,
          }),
        ).toBeInViewport();
        await expect(
          book.getByRole("button", {
            name: chinese ? "关闭绘图图例" : "Close drawing examples",
          }),
        ).toBeInViewport();
        expect(await page.evaluate(() => [scrollX, scrollY])).toEqual([0, 0]);
        // All labels must fit their SVG, including translated text off screen.
        expect(
          await book.locator("svg text").evaluateAll((labels) =>
            labels.every((label) => {
              const box = (label as SVGGraphicsElement).getBBox();
              return (
                box.x >= 0 &&
                box.y >= 0 &&
                box.x + box.width <= 360 &&
                box.y + box.height <= 250
              );
            }),
          ),
        ).toBe(true);
        if (chinese && width === 390 && height === 844) {
          await nav
            .getByRole("button", { name: "三角形凹口", exact: true })
            .click();
          await page.screenshot({
            path: ".generated/drawing-guide-mobile.png",
          });
        }
        await page.keyboard.press("Escape");
        await expect(book).toHaveCount(0);
      }
    });
  });
}

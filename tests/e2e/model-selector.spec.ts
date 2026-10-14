import { test, expect, type Page } from "@playwright/test";

const models = [
  "chat-basic",
  "Vision-Alpha",
  "vision-beta",
  ...Array.from(
    { length: 35 },
    (_, index) => `model-${String(index + 1).padStart(2, "0")}`,
  ),
  `provider/${"long-model-name-".repeat(6)}vision`,
];
async function openSettings(page: Page, discovered = models) {
  await page.route("**/api/models", (route) =>
    route.fulfill({ json: { models: discovered } }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Model settings" }).click();
  await page
    .getByLabel("Base URL", { exact: true })
    .fill("https://models.example/v1");
  await page
    .getByLabel("API key", { exact: true })
    .fill("local-model-test-key");
  await page.getByRole("button", { name: "Discover models" }).click();
  await expect(
    page.getByText(`${discovered.length} models found.`, { exact: false }),
  ).toBeVisible();
}

test("model input and arrow open every discovered model; filtering, selection and persistence work", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openSettings(page);
  const input = page.getByRole("combobox", { name: "Model", exact: true });
  const list = page.getByRole("listbox", { name: "Models" });
  await input.click();
  await expect(input).toHaveAttribute("aria-expanded", "true");
  await expect(list.getByRole("option")).toHaveCount(models.length);
  const inputBox = (await input.boundingBox())!;
  const listBox = (await list.boundingBox())!;
  expect(listBox.height).toBeLessThanOrEqual(242);
  expect(Math.abs(inputBox.width - listBox.width)).toBeLessThan(2);
  expect(Math.abs(inputBox.x - listBox.x)).toBeLessThan(2);
  expect(
    await list.evaluate((node) => node.scrollHeight > node.clientHeight),
  ).toBe(true);
  expect(await list.evaluate((node) => !!node.closest("dialog[open]"))).toBe(
    true,
  );
  await page.screenshot({
    path: ".generated/draftline-model-selector.png",
    fullPage: true,
  });
  await input.press("Escape");
  await expect(list).toHaveCount(0);
  await expect(page.getByRole("dialog")).toBeVisible();
  // Clicking the input again must also reopen it while focus is already there.
  await input.click();
  await expect(list.getByRole("option")).toHaveCount(models.length);
  await input.fill("vISion");
  await expect(
    list.getByRole("option", { name: "Vision-Alpha", exact: true }),
  ).toBeVisible();
  await expect(
    list.getByRole("option", { name: "vision-beta", exact: true }),
  ).toBeVisible();
  await expect(
    list.getByRole("option", { name: "chat-basic", exact: true }),
  ).toHaveCount(0);
  await list.getByRole("option", { name: "vision-beta", exact: true }).click();
  await expect(input).toHaveValue("vision-beta");
  await expect(list).toHaveCount(0);
  await expect(input).toBeFocused();
  await page.getByRole("button", { name: "Show models", exact: true }).click();
  await expect(list.getByRole("option")).toHaveCount(models.length);
  await expect(
    list.getByRole("option", { name: "vision-beta", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".model-toggle svg")).toHaveCount(1);
  await input.press("End");
  await expect
    .poll(() => list.evaluate((node) => node.scrollTop))
    .toBeGreaterThan(0);
  await input.press("Enter");
  await expect(input).toHaveValue(models.at(-1)!);
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Show models", exact: true }).click();
  await input.press("Home");
  await input.press("ArrowDown");
  await input.press("ArrowUp");
  await input.press("Enter");
  await expect(input).toHaveValue("chat-basic");
  await page.getByRole("button", { name: "Save settings" }).click();
  await page.reload();
  await page.getByRole("button", { name: "Model settings" }).click();
  await expect(input).toHaveValue("chat-basic");
  await expect(page.getByLabel("Base URL", { exact: true })).toHaveValue(
    "https://models.example/v1",
  );
  await expect(page.getByLabel("API key", { exact: true })).toHaveValue(
    "local-model-test-key",
  );
});

test("custom model IDs can be selected or saved directly, including with no discovered models", async ({
  page,
}) => {
  await openSettings(page);
  const input = page.getByRole("combobox", { name: "Model", exact: true });
  const list = page.getByRole("listbox", { name: "Models" });
  await input.fill("custom/tenant-model");
  await expect(list.getByRole("option")).toHaveCount(1);
  await expect(list).toContainText("No discovered models match");
  await input.press("ArrowDown");
  await input.press("Enter");
  await expect(input).toHaveValue("custom/tenant-model");
  // A custom ID may also share a prefix with discovered IDs and be saved on blur.
  await input.fill("vision");
  await input.press("Tab");
  await expect(input).toHaveValue("vision");
  await page.getByRole("button", { name: "Save settings" }).click();
  await page.reload();
  await page.getByRole("button", { name: "Model settings" }).click();
  await expect(input).toHaveValue("vision");
  await page.getByRole("button", { name: "Show models", exact: true }).click();
  await expect(list).toContainText("Discover models above");
  await input.fill("another-custom-model");
  await page.getByRole("button", { name: "Save settings" }).click();
  await page.reload();
  await page.getByRole("button", { name: "Model settings" }).click();
  await expect(input).toHaveValue("another-custom-model");
});

test("mobile model menu fits the input and viewport and selects models", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openSettings(page);
  await page.getByRole("button", { name: "Show models", exact: true }).click();
  const list = page.getByRole("listbox", { name: "Models" });
  await expect(list).toBeVisible();
  const box = (await list.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(844);
  await list.getByRole("option", { name: "Vision-Alpha", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "Model", exact: true }),
  ).toHaveValue("Vision-Alpha");
  await expect(page.getByRole("dialog")).toBeVisible();
});

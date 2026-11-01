import { test, expect } from "../helpers/workspace-test";

test("changing credentials invalidates discovered models and an in-flight test", async ({
  page,
}) => {
  await page.route("**/api/models", (route) =>
    route.fulfill({ json: { models: ["old-model"] } }),
  );
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/test", async (route) => {
    await gate;
    await route
      .fulfill({
        contentType: "text/event-stream",
        body: 'event: result\ndata: {"ok":true,"model":"old-model"}\n\n',
      })
      .catch(() => {});
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Model settings", exact: true })
    .click();
  await page
    .getByLabel("Base URL", { exact: true })
    .fill("https://models.example/v1");
  await page.getByLabel("API key", { exact: true }).fill("test-key");
  await page.getByRole("button", { name: "Discover models" }).click();
  await expect(page.getByRole("status")).toContainText("1 models found");
  await page
    .getByRole("combobox", { name: "Model", exact: true })
    .fill("old-model");
  await page.getByLabel("API key", { exact: true }).click();
  const requested = page.waitForRequest("**/api/test");
  await page.getByRole("button", { name: "Test connection" }).click();
  await requested;
  await page
    .getByLabel("Base URL", { exact: true })
    .fill("https://new.example/v1");
  release();
  await expect(
    page.getByRole("button", { name: "Test connection" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Show models", exact: true }).click();
  await expect(page.getByRole("listbox")).toContainText(
    "Discover models above",
  );
  await expect(page.getByRole("status")).toHaveCount(0);
  await page
    .getByRole("combobox", { name: "Model", exact: true })
    .press("Escape");
  await page.getByRole("button", { name: "Save settings" }).click();
  await page.reload();
  await page
    .getByRole("button", { name: "Model settings", exact: true })
    .click();
  await expect(page.getByLabel("Base URL", { exact: true })).toHaveValue(
    "https://new.example/v1",
  );
  await expect(
    page.getByRole("combobox", { name: "Model", exact: true }),
  ).toHaveValue("old-model");
});

test("settings actions stay visible in a short viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 500 });
  await page.goto("/");
  await page.getByRole("button", { name: "Expand sidebar" }).click();
  await page
    .getByRole("button", { name: "Model settings", exact: true })
    .click();
  await page
    .locator("summary")
    .filter({ hasText: "Advanced settings" })
    .click();
  const bounds = await page
    .getByRole("button", { name: "Save settings" })
    .boundingBox();
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(500);
  await page.screenshot({ path: ".generated/settings-mobile.png" });
});

test("project backups restore a separate persistent copy and sorting preference survives reload", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Drawing instructions").fill("Keep this draft");
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Back up project", exact: true })
    .click();
  const file = await download;
  await page
    .getByLabel("Project backup file")
    .setInputFiles((await file.path())!);
  await expect(
    page.getByRole("button", {
      name: "Open drawing Mounting plate 2",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Open drawing Mounting plate 2", exact: true })
    .click();
  await expect(page.getByLabel("Drawing instructions")).toHaveValue(
    "Keep this draft",
  );
  await page.getByLabel("Sort drawings").selectOption("updatedAt");
  await page.reload();
  await expect(page.getByLabel("Sort drawings")).toHaveValue("updatedAt");
  await expect(page.getByLabel("Drawing instructions")).toHaveValue(
    "Keep this draft",
  );
});

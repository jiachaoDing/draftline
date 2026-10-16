import { test, expect } from "@playwright/test";

test("drawing order follows creation time through opening, editing, renaming and reload", async ({
  page,
}) => {
  await page.goto("/");
  const drawings = page
    .getByRole("navigation", { name: "Drawing projects" })
    .locator(".project-open");
  await page.getByRole("button", { name: "New Drawing", exact: true }).click();
  await page.getByRole("button", { name: "New Drawing", exact: true }).click();
  await expect(drawings).toHaveText([
    "Untitled drawing 2",
    "Untitled drawing",
    "Mounting plate",
  ]);
  await page
    .getByRole("button", { name: "Open drawing Mounting plate", exact: true })
    .click();
  await page
    .getByLabel("Drawing instructions")
    .fill("Keep this draft on the oldest drawing");
  await expect(drawings).toHaveText([
    "Untitled drawing 2",
    "Untitled drawing",
    "Mounting plate",
  ]);
  await page
    .getByRole("button", {
      name: "Drawing actions for Mounting plate",
      exact: true,
    })
    .click();
  await page
    .getByRole("menuitem", {
      name: "Rename drawing Mounting plate",
      exact: true,
    })
    .click();
  await page.getByLabel("Project name", { exact: true }).fill("Oldest drawing");
  await page
    .getByRole("button", { name: "Save project name", exact: true })
    .click();
  await expect(drawings).toHaveText([
    "Untitled drawing 2",
    "Untitled drawing",
    "Oldest drawing",
  ]);
  await expect(page.locator(".saved-indicator")).toHaveText("Saved locally");
  await page.reload();
  await expect(drawings).toHaveText([
    "Untitled drawing 2",
    "Untitled drawing",
    "Oldest drawing",
  ]);
  await expect(page.getByLabel("Drawing instructions")).toHaveValue(
    "Keep this draft on the oldest drawing",
  );
  await page.getByRole("button", { name: "New Drawing", exact: true }).click();
  await expect(drawings).toHaveText([
    "Untitled drawing 3",
    "Untitled drawing 2",
    "Untitled drawing",
    "Oldest drawing",
  ]);
});

test("drawing navigation supports search, long lists, collapse and keyboard actions", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
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
        for (let index = 1; index <= 40; index++) {
          store.put({
            ...request.result[0],
            id: `fixture-${index}`,
            name: `Fixture drawing ${index}`,
            renamed: true,
            createdAt: Date.now() - index * 1000,
            updatedAt: Date.now() - index * 1000,
          });
        }
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
  const navigation = page.getByRole("navigation", { name: "Drawing projects" });
  await expect(
    navigation.getByRole("button", { name: /Open drawing/ }),
  ).toHaveCount(41);
  const last = navigation.getByRole("button", {
    name: "Open drawing Fixture drawing 40",
    exact: true,
  });
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport();
  expect(
    await page
      .locator(".drawings-scroll")
      .evaluate((element) => element.scrollTop),
  ).toBeGreaterThan(0);
  expect(
    await page
      .locator(".left-panel")
      .evaluate((element) => element.scrollHeight - element.clientHeight),
  ).toBeLessThanOrEqual(1);

  await page
    .getByLabel("Search drawings", { exact: true })
    .fill("FIXTURE DRAWING 40");
  await expect(
    navigation.getByRole("button", { name: /Open drawing/ }),
  ).toHaveCount(1);
  await last.click();
  await expect(last).toHaveAttribute("aria-current", "page");
  await expect(page.getByLabel("Search drawings", { exact: true })).toHaveValue(
    "FIXTURE DRAWING 40",
  );
  const actions = page.getByRole("button", {
    name: "Drawing actions for Fixture drawing 40",
    exact: true,
  });
  await last.focus();
  await page.keyboard.press("Tab");
  await expect(actions).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("menuitem", {
      name: "Rename drawing Fixture drawing 40",
      exact: true,
    }),
  ).toHaveAttribute("data-focus");
  await page.keyboard.press("Enter");
  const name = page.getByLabel("Project name", { exact: true });
  await expect(name).toBeFocused();
  await name.fill("  ");
  await expect(
    page.getByRole("button", { name: "Save project name" }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(actions).toBeFocused();

  await page
    .getByLabel("Search drawings", { exact: true })
    .fill("no matching drawing");
  await expect(page.getByText("No drawings found.")).toBeVisible();
  await page.getByRole("button", { name: "Clear drawing search" }).click();
  await expect(
    navigation.getByRole("button", { name: /Open drawing/ }),
  ).toHaveCount(41);
  await page.screenshot({ path: ".generated/sidebar-desktop.png" });
  const before = await page.locator(".drawing-workspace").boundingBox();
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(
    page.getByLabel("Search drawings", { exact: true }),
  ).toBeHidden();
  await expect
    .poll(
      async () =>
        (await page.locator(".drawing-workspace").boundingBox())!.width,
    )
    .toBeGreaterThan(before!.width + 200);
  await page.getByRole("button", { name: "Expand sidebar" }).click();
  await expect(last).toHaveAttribute("aria-current", "page");
});

test("mobile drawer closes on navigation and canvas layers retain per-drawing visibility", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const frame = page.frameLocator('iframe[title="Technical drawing preview"]');
  await expect(frame.locator("#plate-outline")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Expand sidebar" }),
  ).toHaveAttribute("aria-expanded", "false");
  const starter = await page.locator(".project-title").textContent();
  await page
    .getByRole("button", { name: "Drawing layers", exact: true })
    .click();
  for (const layer of ["geometry", "dimensions", "presentation"]) {
    await page.getByLabel(`Show ${layer}`, { exact: true }).uncheck();
    await expect(frame.locator(`#${layer}`)).toHaveAttribute("display", "none");
  }
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Expand sidebar" }).click();
  const drawer = page.getByRole("dialog", { name: "Drawing navigation" });
  await expect(drawer).toBeVisible();
  await expect
    .poll(
      async () =>
        (await page.locator(".sidebar-drawer-panel").boundingBox())?.x,
    )
    .toBe(0);
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Expand sidebar" }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Expand sidebar" }).click();
  await page.getByRole("button", { name: "New Drawing", exact: true }).click();
  await expect(drawer).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Drawing layers", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Expand sidebar" }).click();
  await expect
    .poll(
      async () =>
        (await page.locator(".sidebar-drawer-panel").boundingBox())?.x,
    )
    .toBe(0);
  await page.screenshot({ path: ".generated/sidebar-mobile.png" });
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
  await page.getByLabel("Project name", { exact: true }).fill("Mobile bracket");
  await page.getByRole("button", { name: "Save project name" }).click();
  await page
    .getByRole("button", { name: `Open drawing ${starter}`, exact: true })
    .click();
  await expect(drawer).toBeHidden();
  await page
    .getByRole("button", { name: "Drawing layers", exact: true })
    .click();
  for (const layer of ["geometry", "dimensions", "presentation"]) {
    await expect(
      page.getByLabel(`Show ${layer}`, { exact: true }),
    ).not.toBeChecked();
    await page.getByLabel(`Show ${layer}`, { exact: true }).check();
  }
  await expect(frame.locator("#plate-outline")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.screenshot({
    path: ".generated/sidebar-mobile-canvas.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.getByRole("button", { name: "Expand sidebar" }).click();
  await page
    .getByRole("button", {
      name: "Drawing actions for Mobile bracket",
      exact: true,
    })
    .click();
  await page
    .getByRole("menuitem", {
      name: "Delete drawing Mobile bracket",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "Keep", exact: true }).click();
  await expect(drawer).toBeVisible();
  await page
    .getByRole("button", {
      name: "Drawing actions for Mobile bracket",
      exact: true,
    })
    .click();
  await page
    .getByRole("menuitem", {
      name: "Delete drawing Mobile bracket",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: "Open drawing Mobile bracket",
      exact: true,
    }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Close sidebar", exact: true })
    .click();
  await expect(frame.locator("#plate-outline")).toBeVisible();
  await page.getByRole("button", { name: "Code", exact: true }).click();
  await expect(page.getByLabel("Drawing source code")).toBeVisible();
  await page.getByRole("button", { name: "Drawing", exact: true }).click();
  await expect(frame.locator("#plate-outline")).toBeVisible();
});

test("new drawing names stay distinct and project menus preserve rename and delete", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New Drawing", exact: true }).click();
  await page.getByRole("button", { name: "New Drawing", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: "Open drawing Untitled drawing 2",
      exact: true,
    }),
  ).toHaveAttribute("aria-current", "page");
  const actions = page.getByRole("button", {
    name: "Drawing actions for Untitled drawing 2",
    exact: true,
  });
  await actions.click();
  await page
    .getByRole("menuitem", {
      name: "Rename drawing Untitled drawing 2",
      exact: true,
    })
    .click();
  const name = "Mounting bracket with a long descriptive drawing name";
  await page.getByLabel("Project name", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Save project name" }).click();
  await expect(
    page.getByRole("button", { name: `Open drawing ${name}`, exact: true }),
  ).toHaveAttribute("title", name);
  await page.reload();
  const renamedActions = page.getByRole("button", {
    name: `Drawing actions for ${name}`,
    exact: true,
  });
  await renamedActions.click();
  await page
    .getByRole("menuitem", { name: `Delete drawing ${name}`, exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Delete drawing?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Keep", exact: true }).click();
  await expect(renamedActions).toBeFocused();
  await renamedActions.click();
  await page
    .getByRole("menuitem", { name: `Delete drawing ${name}`, exact: true })
    .click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(
    page.getByRole("button", { name: `Open drawing ${name}`, exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: "Open drawing Untitled drawing",
      exact: true,
    }),
  ).toHaveAttribute("aria-current", "page");
});

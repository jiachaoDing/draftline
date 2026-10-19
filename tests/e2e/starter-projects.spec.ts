import { test, expect } from "@playwright/test";
import { waitForProjectSave } from "../helpers/project-storage";

test.use({ locale: "en-US" });

const names = ["样例1", "样例2", "样例3", "样例4"];

test("first visit installs four clean, editable samples once and preserves workspace changes", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await page
    .getByRole("combobox", { name: "语言", exact: true })
    .selectOption("en");
  const projects = page.locator(".project-open");
  await expect(projects).toHaveText(names);
  for (const name of names) {
    await page
      .getByRole("button", { name: `Open drawing ${name}`, exact: true })
      .click();
    const frame = page.frameLocator(
      'iframe[title="Technical drawing preview"]',
    );
    await expect(frame.locator("#geometry")).toBeAttached();
    await expect(page.locator(".chat-message.assistant").last()).toBeVisible();
    await expect(
      page.locator(".chat-message.error, .chat-message.cancelled"),
    ).toHaveCount(0);
    await expect(
      page.getByText(
        /streaming connection was interrupted|drawing could not be applied|Reply incomplete/,
      ),
    ).toHaveCount(0);
  }
  await page.getByLabel("Drawing instructions").fill("Keep my sample draft");
  await waitForProjectSave(page);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(projects).toHaveText(names);
  await expect(page.getByLabel("Drawing instructions")).toHaveValue(
    "Keep my sample draft",
  );
  await expect(page.locator(".project-title")).toHaveText(names[3]);
  await page
    .getByRole("button", {
      name: `Drawing actions for ${names[0]}`,
      exact: true,
    })
    .click();
  await page
    .getByRole("menuitem", { name: `Delete drawing ${names[0]}`, exact: true })
    .click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(projects).toHaveCount(3);
  await waitForProjectSave(page);
  await page.reload();
  await expect(projects).toHaveText(names.slice(1));
});

test("an existing single-drawing workspace is restored without adding samples", async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (window === window.top)
      localStorage.setItem("draftline-drawing", "invalid");
  });
  await page.goto("/");
  await expect(page.locator(".project-open")).toHaveCount(4);
  await waitForProjectSave(page);
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open("draftline-projects", 1);
      request.onsuccess = () => resolve(request.result);
    });
    const transaction = db.transaction("projects", "readwrite");
    const store = transaction.objectStore("projects");
    const records = store.getAll();
    records.onsuccess = () => {
      store.clear();
      store.put({ ...records.result[0], id: "existing", name: "My drawing" });
    };
    await new Promise<void>((resolve) => {
      transaction.oncomplete = () => resolve();
    });
    db.close();
  });
  await page.reload();
  await expect(page.locator(".project-open")).toHaveText(["My drawing"]);
});

import { waitForProjectSave } from "../helpers/project-storage";
import { expect, test } from "../helpers/workspace-test";
import type { Page } from "@playwright/test";

async function savedDraft(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("draftline-projects", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<string>((resolve, reject) => {
        const request = db
          .transaction("projects")
          .objectStore("projects")
          .getAll();
        request.onsuccess = () =>
          resolve(
            request.result.find((project) => project.name === "Mounting plate")
              ?.chatInput,
          );
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  });
}

test("native IME composition and caret survive frequent autosaves and restore per project", async ({
  page,
}) => {
  await page.goto("/");
  const input = page.getByLabel("Drawing instructions");
  await waitForProjectSave(page);
  await expect(page.locator(".header-actions")).not.toContainText(
    /Saved locally|Saving locally/,
  );
  await input.fill("Plate:  mm");
  await input.evaluate((element: HTMLTextAreaElement) => {
    element.focus();
    element.setSelectionRange(7, 7);
    const events: string[] = [];
    Object.assign(window, {
      composerInput: element,
      compositionEvents: events,
    });
    for (const type of [
      "compositionstart",
      "compositionupdate",
      "compositionend",
    ])
      element.addEventListener(type, () => events.push(type));
  });
  const cdp = await page.context().newCDPSession(page);
  for (const text of ["n", "ni", "ni h", "ni hao", "你好"]) {
    await cdp.send("Input.imeSetComposition", {
      text,
      selectionStart: text.length,
      selectionEnd: text.length,
    });
    await expect(input).toHaveValue(`Plate: ${text} mm`);
    await waitForProjectSave(page);
    await expect.poll(() => savedDraft(page)).toBe(`Plate: ${text} mm`);
    // IME confirmation must never send a message or open model settings.
    await input.dispatchEvent("keydown", {
      key: "Enter",
      isComposing: true,
      keyCode: 229,
    });
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(
      await input.evaluate((element: HTMLTextAreaElement) => ({
        same:
          element ===
          (window as unknown as { composerInput: Element }).composerInput,
        focused: document.activeElement === element,
        start: element.selectionStart,
        end: element.selectionEnd,
      })),
    ).toEqual({
      same: true,
      focused: true,
      start: 7 + text.length,
      end: 7 + text.length,
    });
  }
  await cdp.send("Input.insertText", { text: "你好" });
  await expect(input).toHaveValue("Plate: 你好 mm");
  for (const text of ["，", "宽", "120", "×80"]) {
    await page.keyboard.insertText(text);
    await waitForProjectSave(page);
  }
  const draft = "Plate: 你好，宽120×80 mm";
  await expect(input).toHaveValue(draft);
  await page.keyboard.press("Shift+Enter");
  await input.pressSequentially("1234567890 abcdefghijklmnopqrstuvwxyz");
  const multilineDraft =
    "Plate: 你好，宽120×80\n1234567890 abcdefghijklmnopqrstuvwxyz mm";
  await expect(input).toHaveValue(multilineDraft);
  const events = await page.evaluate(
    () =>
      (window as unknown as { compositionEvents: string[] }).compositionEvents,
  );
  expect(events.filter((type) => type === "compositionstart")).toHaveLength(1);
  expect(
    events.filter((type) => type === "compositionupdate").length,
  ).toBeGreaterThanOrEqual(5);
  expect(events.filter((type) => type === "compositionend")).toHaveLength(1);
  await page.getByRole("button", { name: "New Drawing", exact: true }).click();
  await expect(input).toHaveValue("");
  await input.fill("会话 B 草稿");
  await page
    .getByRole("button", { name: "Open drawing Mounting plate", exact: true })
    .click();
  await expect(input).toHaveValue(multilineDraft);
  await page.reload();
  await expect(input).toHaveValue(multilineDraft);
  await page
    .getByRole("button", { name: "Open drawing Untitled drawing", exact: true })
    .click();
  await expect(input).toHaveValue("会话 B 草稿");
});

test("a late example preserves newer typing and explicit suggestions still persist", async ({
  page,
}) => {
  let release = () => {};
  let requested = () => {};
  const started = new Promise<void>((resolve) => {
    requested = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/example-sketch.svg", async (route) => {
    requested();
    await gate;
    await route.continue();
  });
  await page.goto("/");
  const input = page.getByLabel("Drawing instructions");
  await page.getByRole("button", { name: "Try an example" }).click();
  await started;
  await input.fill("Newer draft while the image loads");
  release();
  await expect(page.locator(".composer-attachment")).toHaveCount(1);
  await expect(input).toHaveValue("Newer draft while the image loads");
  await page
    .getByRole("button", { name: "Make the plate 140 mm wide" })
    .click();
  await expect(input).toHaveValue("Make the plate 140 mm wide");
  await waitForProjectSave(page);
  await page.reload();
  await expect(input).toHaveValue("Make the plate 140 mm wide");
  await expect(page.locator(".composer-attachment")).toHaveCount(1);
});

test("an example finishing after switching away and back cannot mutate the reopened composer", async ({
  page,
}) => {
  let release = () => {};
  let requested = () => {};
  const started = new Promise<void>((resolve) => {
    requested = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/example-sketch.svg", async (route) => {
    requested();
    await gate;
    await route.continue();
  });
  await page.goto("/");
  const input = page.getByLabel("Drawing instructions");
  await input.fill("Original draft");
  await page.getByRole("button", { name: "Try an example" }).click();
  await started;
  await page.getByRole("button", { name: "New Drawing", exact: true }).click();
  await input.fill("Other project draft");
  await page
    .getByRole("button", { name: "Open drawing Mounting plate", exact: true })
    .click();
  release();
  await expect(input).toHaveValue("Original draft");
  await expect(page.locator(".composer-attachment")).toHaveCount(0);
  await waitForProjectSave(page);
  await page.reload();
  await expect(input).toHaveValue("Original draft");
  await expect(page.locator(".composer-attachment")).toHaveCount(0);
});

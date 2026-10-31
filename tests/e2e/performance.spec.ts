import { test, expect } from "../helpers/workspace-test";
import { EXAMPLE_SVG } from "../../src/lib/example";

test("opening drawings and typing drafts keeps formatter and editor unloaded", async ({
  page,
}) => {
  const tooling: string[] = [];
  page.on("request", (request) => {
    if (/prettier|codemirror/i.test(request.url())) tooling.push(request.url());
  });
  await page.goto("/");
  await expect(
    page.frameLocator("iframe").locator("#plate-outline"),
  ).toBeVisible();
  await page.getByLabel("Drawing instructions").fill("Keep this draft");
  await page.getByRole("button", { name: "New Drawing", exact: true }).click();
  await page
    .getByRole("button", { name: "Open drawing Mounting plate", exact: true })
    .click();
  await expect(
    page.frameLocator("iframe").locator("#plate-outline"),
  ).toBeVisible();
  await expect(page.getByLabel("Drawing instructions")).toHaveValue(
    "Keep this draft",
  );
  await expect(
    page.getByRole("button", { name: "Code", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Drawing source code")).toHaveCount(0);
  expect(tooling).toEqual([]);
});

test("repeated sandbox validation releases frames and listeners beyond 94 iterations", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page
      .frameLocator('iframe[title="Technical drawing preview"]')
      .locator("#drawing"),
  ).toBeVisible();
  const result = await page.evaluate(async (svg) => {
    const modulePath = "/src/lib/validate-source.ts";
    const { validateDrawingSource } = await import(modulePath);
    const listeners = new Set<EventListenerOrEventListenerObject>();
    const add = window.addEventListener;
    const remove = window.removeEventListener;
    // Track only listeners installed during validation, excluding the preview.
    window.addEventListener = function (
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ) {
      if (type === "message") listeners.add(listener);
      return add.call(this, type, listener, options);
    };
    window.removeEventListener = function (
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | EventListenerOptions,
    ) {
      if (type === "message") listeners.delete(listener);
      return remove.call(this, type, listener, options);
    };
    let completed = 0;
    try {
      for (let index = 0; index < 100; index++) {
        await validateDrawingSource(svg, new AbortController().signal);
        if (document.querySelector(".validation-preview") || listeners.size)
          throw new Error(
            `Validation resources remain after iteration ${index}`,
          );
        completed++;
      }
      return { completed, frames: document.querySelectorAll("iframe").length };
    } finally {
      window.addEventListener = add;
      window.removeEventListener = remove;
    }
  }, EXAMPLE_SVG);
  expect(result).toEqual({ completed: 100, frames: 1 });
});

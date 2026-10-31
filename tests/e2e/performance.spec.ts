import { test, expect } from "../helpers/workspace-test";
import { EXAMPLE_SVG } from "../../src/lib/example";

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

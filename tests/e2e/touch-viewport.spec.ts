import { test, expect } from "../helpers/workspace-test";

test.use({
  hasTouch: true,
  isMobile: true,
  viewport: { width: 390, height: 844 },
});

test("mobile pinch zooms the drawing without scrolling the page or changing selection", async ({
  page,
}) => {
  await page.goto("/");
  const frame = page.frameLocator('iframe[title="Technical drawing preview"]');
  const hole = frame.locator("#hole-top-left");
  await hole.click();
  await expect(hole).toHaveAttribute("data-selected", "true");
  const bounds = (await page.locator(".canvas").boundingBox())!;
  const center = {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };
  const zoom = () =>
    page
      .locator(".zoom-controls")
      .innerText()
      .then((text) => Number(text.match(/([\d.]+)%/)![1]));
  const initial = await zoom();
  const client = await page.context().newCDPSession(page);
  const points = (radius: number) => [
    { id: 1, x: center.x - radius, y: center.y },
    { id: 2, x: center.x + radius, y: center.y },
  ];
  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: points(30),
  });
  for (const radius of [35, 40, 50, 60, 70])
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: points(radius),
    });
  await expect.poll(zoom).toBeGreaterThan(initial * 1.5);
  const enlarged = await zoom();
  for (const radius of [60, 50, 40, 30, 20])
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: points(radius),
    });
  await expect.poll(zoom).toBeLessThan(enlarged / 1.5);
  await client.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect(hole).toHaveAttribute("data-selected", "true");
  await expect(hole).toHaveAttribute("r", "5");
  expect(await page.evaluate(() => [scrollX, scrollY])).toEqual([0, 0]);
  await page.getByRole("button", { name: "Fit drawing", exact: true }).click();
  await frame.locator("#hole-top-right").click();
  await expect(frame.locator("#hole-top-right")).toHaveAttribute(
    "data-selected",
    "true",
  );
});

import { waitForProjectSave } from "../helpers/project-storage";
import { test, expect } from "../helpers/workspace-test";
import type { Page } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { completeResponse, toolResponse } from "../helpers/provider-stream";
import { OBJECT_SVG } from "../helpers/object-drawing";
import { inspectedHTML } from "../helpers/source-patch";

let provider: Server;
let baseURL: string;
let requests: any[] = [];
test.beforeAll(async () => {
  provider = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const input = JSON.parse(body);
    requests.push(input);
    const last = input.messages.at(-1);
    if (last.role !== "tool") {
      toolResponse(res, [
        {
          id: "inspect_logo",
          name: "read_source",
          arguments: JSON.stringify({
            file_path: "drawing.html",
            element_id: "logo",
            limit: 200,
          }),
        },
      ]);
    } else if (last.tool_call_id === "inspect_logo") {
      const read = JSON.parse(last.content);
      const line = inspectedHTML(read.text)
        .split("\n")
        .find((line) => line.includes('transform="translate(15 20)"'))!;
      toolResponse(res, [
        {
          id: "move_logo",
          name: "apply_patch",
          arguments: JSON.stringify({
            revision: read.revision,
            patch: `*** Begin Patch\n*** Update File: drawing.html\n@@\n-${line}\n+${line.replace("translate(15 20)", "translate(30 20)")}\n*** End Patch`,
          }),
        },
      ]);
    } else {
      completeResponse(
        res,
        JSON.stringify({
          kind: "message",
          message: "Moved the complete logo, including its paths and text.",
        }),
      );
    }
  });
  await new Promise<void>((resolve) =>
    provider.listen(0, "127.0.0.1", resolve),
  );
  baseURL = `http://127.0.0.1:${(provider.address() as { port: number }).port}/v1`;
});
test.afterAll(
  () => new Promise<void>((resolve) => provider.close(() => resolve())),
);

async function openObjects(page: Page) {
  requests = [];
  await page.addInitScript((url) => {
    if (window !== window.top) return;
    localStorage.setItem(
      "draftline-model",
      JSON.stringify({
        baseURL: url,
        apiKey: "selection-test-key",
        model: "vision-test",
      }),
    );
  }, baseURL);
  await page.goto("/");
  await page.getByRole("button", { name: "Code", exact: true }).click();
  await page.getByLabel("Drawing source code").fill(OBJECT_SVG);
  await page.getByRole("button", { name: "Apply code", exact: true }).click();
  const frame = page.frameLocator('iframe[title="Technical drawing preview"]');
  await expect(frame.locator("#logo")).toHaveAttribute(
    "transform",
    "translate(15 20)",
  );
  await expect(frame.locator("body")).toHaveAttribute("data-mode", "select");
  return frame;
}

test("selects groups, enters nested groups, toggles multi-selection and groups with undo/redo", async ({
  page,
}) => {
  const frame = await openObjects(page);
  await frame.locator("#logo-left").click();
  await expect(frame.locator("#logo")).toHaveAttribute("data-selected", "true");
  await expect(page.locator(".selection-card strong")).toHaveText(
    "DraftLine logo",
  );
  await frame.locator("#logo-left").dblclick();
  await expect(page.getByLabel("Editing hierarchy")).toContainText(
    "DraftLine logo",
  );
  await frame.locator("#logo-left").click();
  await expect(frame.locator("#mark")).toHaveAttribute("data-selected", "true");
  await frame.locator("#logo-left").dblclick();
  await expect(page.getByLabel("Editing hierarchy")).toContainText(
    "Logo symbol",
  );
  await frame.locator("#logo-left").click();
  await frame.locator("#logo-right").click({ modifiers: ["Shift"] });
  await expect(page.locator(".selection-card strong")).toHaveText(
    "2 objects selected",
  );
  await frame.locator("#logo-right").click({ modifiers: ["Shift"] });
  await expect(page.locator(".selection-card strong")).toHaveText("logo left");
  await frame.locator("#logo-right").click({ modifiers: ["Shift"] });
  await page.getByRole("button", { name: "Group", exact: true }).click();
  await expect(frame.locator("#mark > g[id^=object-]")).toHaveCount(1);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(frame.locator("#mark > #logo-left")).toHaveCount(1);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(frame.locator("#mark > g[id^=object-]")).toHaveCount(1);
  await frame.locator("#logo-left").click({ modifiers: ["Control"] });
  await expect(frame.locator("#logo-left")).toHaveAttribute(
    "data-selected",
    "true",
  );
  await expect(frame.locator("#logo")).not.toHaveAttribute(
    "data-selected",
    "true",
  );
  await page
    .getByRole("button", { name: "Entire drawing", exact: true })
    .click();
  await frame.locator("#logo-left").click();
  await page.getByRole("button", { name: "Ungroup", exact: true }).click();
  await expect(frame.locator("#logo")).toHaveCount(0);
  await expect(frame.locator("#wordmark")).toHaveText("DraftLine");
});

test("marquee selection uses visible groups after zoom, adds with Shift and keeps overlays out of SVG exports", async ({
  page,
}) => {
  const frame = await openObjects(page);
  const initialWidth = (await frame.locator("#logo").boundingBox())!.width;
  await page.getByRole("button", { name: "Zoom out", exact: true }).click();
  await expect
    .poll(async () => (await frame.locator("#logo").boundingBox())!.width)
    .toBeLessThan(initialWidth);
  const logo = (await frame.locator("#logo").boundingBox())!;
  const separate = (await frame.locator("#nearby").boundingBox())!;
  await page.mouse.move(logo.x - 8, logo.y - 8);
  await page.mouse.down();
  await page.mouse.move(logo.x + logo.width + 8, logo.y + logo.height + 8, {
    steps: 12,
  });
  await page.mouse.up();
  await expect(frame.locator("#logo")).toHaveAttribute("data-selected", "true");
  await expect(frame.locator("#nearby")).not.toHaveAttribute(
    "data-selected",
    "true",
  );
  await page.keyboard.down("Shift");
  await page.mouse.move(separate.x - 6, separate.y - 6);
  await page.mouse.down();
  await page.mouse.move(
    separate.x + separate.width + 6,
    separate.y + separate.height + 6,
    { steps: 12 },
  );
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await expect(page.locator(".selection-card strong")).toHaveText(
    "2 objects selected",
  );
  await page
    .getByRole("button", { name: "Drawing layers", exact: true })
    .click();
  await page.getByLabel("Show dimensions").uncheck();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Export SVG", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /Geometry only/ }).click();
  const stream = await (await download).createReadStream();
  let exported = "";
  for await (const chunk of stream!) exported += chunk.toString();
  expect(exported).toContain('id="logo"');
  expect(exported).toContain('id="wordmark"');
  expect(exported).not.toMatch(
    /data-selected|data-marquee-target|svg-object-outline|svg-pan-zoom/,
  );
});

test("AI can move a whole logo from a selected path; broader changes require review, can be discarded and apply as one undo step", async ({
  page,
}) => {
  const frame = await openObjects(page);
  const send = async () => {
    await frame.locator("#logo-left").click({ modifiers: ["Control"] });
    await expect(page.locator(".selection-card strong")).toHaveText(
      "logo left",
    );
    await page
      .getByLabel("Drawing instructions", { exact: true })
      .fill(
        "Move the whole logo right by 15 mm, including all its text and paths.",
      );
    await page
      .getByRole("button", { name: "Send drawing instruction", exact: true })
      .click();
    await expect(
      page.getByRole("region", { name: "Review AI changes" }),
    ).toBeVisible();
    await expect(frame.locator("#logo")).toHaveAttribute(
      "transform",
      "translate(30 20)",
    );
    await expect(
      frame.locator('.svg-object-outline.changed[data-object-id="logo"]'),
    ).toHaveCount(1);
  };
  await send();
  expect(requests[0].messages.at(-1).content[1].text).toContain(
    '"selected_ids":["logo-left"]',
  );
  expect(JSON.stringify(requests[0].messages)).toContain("nameplate");
  const saved = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const req = indexedDB.open("draftline-projects", 1);
      req.onsuccess = () => resolve(req.result);
    });
    const records = await new Promise<any[]>((resolve) => {
      const req = db.transaction("projects").objectStore("projects").getAll();
      req.onsuccess = () => resolve(req.result);
    });
    db.close();
    return records
      .flatMap((record) => record.history.items)
      .filter(Boolean)
      .map((drawing) => drawing.svg)
      .join("");
  });
  expect(saved).not.toContain("translate(30 20)");
  const original = await page
    .locator('.project-open[aria-current="page"]')
    .getAttribute("aria-label");
  await page.getByRole("button", { name: "New Drawing", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Review AI changes" }),
  ).toHaveCount(0);
  await page.getByLabel("Drawing instructions").fill("Other drawing draft");
  await page.getByRole("button", { name: original!, exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Review AI changes" }),
  ).toBeVisible();
  await expect(frame.locator("#logo")).toHaveAttribute(
    "transform",
    "translate(30 20)",
  );
  await page
    .getByRole("button", { name: "Discard proposal", exact: true })
    .click();
  await expect(frame.locator("#logo")).toHaveAttribute(
    "transform",
    "translate(15 20)",
  );
  await send();
  await page
    .getByRole("button", { name: "Apply AI changes", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Review AI changes" }),
  ).toHaveCount(0);
  await expect(frame.locator("#nearby")).toHaveAttribute("width", "40");
  await expect(frame.locator("#wordmark")).toHaveText("DraftLine");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(frame.locator("#logo")).toHaveAttribute(
    "transform",
    "translate(15 20)",
  );
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(frame.locator("#logo")).toHaveAttribute(
    "transform",
    "translate(30 20)",
  );
  await waitForProjectSave(page);
  await page.reload();
  await expect(frame.locator("#logo")).toHaveAttribute(
    "transform",
    "translate(30 20)",
  );
});

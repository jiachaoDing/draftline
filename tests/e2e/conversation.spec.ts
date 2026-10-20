import { test, expect } from "../helpers/workspace-test";
import type { Page } from "@playwright/test";
import { createServer, type Server } from "node:http";
import {
  completeResponse,
  toolResponse,
  openCompletion,
} from "../helpers/provider-stream";
import { EXAMPLE_SVG } from "../../src/lib/example";
import { radiusPatch, inspectedHTML } from "../helpers/source-patch";
import { waitForProjectSave } from "../helpers/project-storage";
import { attachFiles } from "../helpers/attach-files";

let provider: Server;
let baseURL: string;
let requests: any[] = [];
let held = false;
test.beforeEach(() => {
  requests = [];
  held = false;
});
test.beforeAll(async () => {
  provider = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const input = JSON.parse(body);
    requests.push(input);
    const instruction = input.messages
      .findLast((message: any) => message.role === "user")
      .content[0].text.split("\n")[0];
    const matching = requests.filter((item) =>
      item.messages
        .findLast((message: any) => message.role === "user")
        .content[0].text.startsWith(instruction),
    );
    if (instruction === "fail repeatedly") {
      completeResponse(
        response,
        matching.length < 3
          ? "{invalid"
          : '{"kind":"message","message":"Recovered successfully"}',
      );
      return;
    }
    if (instruction === "mixed versions" && matching.length === 2) {
      completeResponse(response, "{invalid");
      return;
    }
    if (instruction === "durable patch") {
      const outputs = input.messages.filter(
        (message: any) => message.role === "tool",
      );
      const output = outputs.at(-1);
      const result = output ? JSON.parse(output.content) : undefined;
      if (!output)
        toolResponse(response, [
          {
            id: "read",
            name: "read_source",
            arguments: '{"file_path":"drawing.html"}',
          },
        ]);
      else if (output.tool_call_id === "read")
        toolResponse(response, [
          {
            id: "patch",
            name: "apply_patch",
            arguments: JSON.stringify({
              revision: result.revision,
              patch: radiusPatch(
                inspectedHTML(result.text),
                "hole-top-left",
                "7",
              ),
            }),
          },
        ]);
      else if (!held) {
        held = true;
        openCompletion(response);
      } else
        toolResponse(response, [
          {
            id: "finish",
            name: "finish_drawing",
            arguments: JSON.stringify({
              revision: result.revision,
              summary: "Durable patch completed",
            }),
          },
        ]);
      return;
    }
    const radius =
      instruction === "edited radius"
        ? 13
        : instruction === "follow up"
          ? 11
          : matching.length === 1
            ? 7
            : 9;
    completeResponse(
      response,
      JSON.stringify({
        kind: "drawing",
        title: "Conversation drawing",
        summary: `Version radius ${radius}`,
        notes: [],
        html: EXAMPLE_SVG.replaceAll('r="5"', `r="${radius}"`),
      }),
    );
  });
  await new Promise<void>((resolve) =>
    provider.listen(0, "127.0.0.1", resolve),
  );
  baseURL = `http://127.0.0.1:${(provider.address() as { port: number }).port}/v1`;
});
test.afterAll(async () => {
  provider.closeAllConnections();
  await new Promise<void>((resolve) => provider.close(() => resolve()));
});

async function open(page: Page) {
  await page.addInitScript(
    (url) =>
      localStorage.setItem(
        "draftline-model",
        JSON.stringify({
          baseURL: url,
          apiKey: "conversation-fixture",
          model: "fixture",
        }),
      ),
    baseURL,
  );
  await page.goto("/");
  await expect(hole(page)).toHaveAttribute("r", "5");
}
const hole = (page: Page) =>
  page
    .frameLocator('iframe[title="Technical drawing preview"]')
    .locator("#hole-top-left");
async function send(page: Page, text: string) {
  await page.getByLabel("Drawing instructions").fill(text);
  await page.getByRole("button", { name: "Send drawing instruction" }).click();
}

test("regenerates from the original canvas, edits user messages and restores saved descendants", async ({
  page,
}) => {
  await open(page);
  await send(page, "branch radius");
  await expect(hole(page)).toHaveAttribute("r", "7");
  await attachFiles(page, {
    name: "future-only.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Later branch resource"),
  });
  await expect(page.getByText("Reading attachment…")).toHaveCount(0);
  await send(page, "follow up");
  await expect(hole(page)).toHaveAttribute("r", "11");
  await attachFiles(page, {
    name: "unsent-only.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Unsent composer draft"),
  });
  await expect(page.getByText("Reading attachment…")).toHaveCount(0);
  await page
    .locator(".chat-message.assistant")
    .filter({ hasText: "Version radius 7" })
    .getByRole("button", { name: "Regenerate response" })
    .click();
  await expect(hole(page)).toHaveAttribute("r", "9");
  expect(requests.at(-1).messages.at(-1).content[0].text).toContain(
    "branch radius",
  );
  expect(requests.at(-1).messages.at(-1).content[0].text).not.toContain(
    "follow up",
  );
  expect(JSON.stringify(requests.at(-1).messages)).not.toContain(
    "future-only.txt",
  );
  expect(JSON.stringify(requests.at(-1).messages)).not.toContain(
    "unsent-only.txt",
  );
  await expect(page.locator(".composer-attachment")).toHaveCount(1);
  await expect(page.locator(".chat-message.user")).toHaveCount(1);
  await page.getByRole("button", { name: "Previous version" }).click();
  await expect(hole(page)).toHaveAttribute("r", "11");
  await expect(page.locator(".chat-message.user")).toHaveCount(2);
  await page.getByRole("button", { name: "Next version" }).click();
  await expect(hole(page)).toHaveAttribute("r", "9");
  await page.getByRole("button", { name: "Edit message", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Edit message" })
    .fill("edited radius");
  await page.getByRole("button", { name: "Save and regenerate" }).click();
  await expect(hole(page)).toHaveAttribute("r", "13");
  await waitForProjectSave(page);
  await page.reload();
  await expect(hole(page)).toHaveAttribute("r", "13");
  await page.getByText("Conversation history", { exact: true }).click();
  await page
    .getByRole("navigation", { name: "Saved branches" })
    .getByRole("button")
    .filter({ hasText: "Version radius 11" })
    .click();
  await expect(hole(page)).toHaveAttribute("r", "11");
  await expect(page.locator(".chat-message.user")).toHaveCount(2);
});

test("retries in place across reloads without duplicating errors or user messages", async ({
  page,
}) => {
  await open(page);
  await send(page, "fail repeatedly");
  await expect(page.locator(".message-error")).toHaveCount(1);
  await page.getByRole("button", { name: "Retry response" }).click();
  await expect(page.locator(".message-error")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Retry response" }),
  ).toBeVisible();
  await expect(page.locator(".chat-message.assistant")).toHaveCount(2);
  await waitForProjectSave(page);
  await page.reload();
  await page.getByRole("button", { name: "Retry response" }).click();
  await expect(
    page.getByText("Recovered successfully", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".message-error")).toHaveCount(0);
  await expect(page.locator(".chat-message.assistant")).toHaveCount(2);
  await expect(page.locator(".chat-message.user")).toHaveCount(1);
  await expect(hole(page)).toHaveAttribute("r", "5");
  expect(requests).toHaveLength(3);
});

test("regenerating a selected successful version creates a sibling beside a failed version", async ({
  page,
}) => {
  await open(page);
  await send(page, "mixed versions");
  await expect(hole(page)).toHaveAttribute("r", "7");
  await page.getByRole("button", { name: "Regenerate response" }).click();
  await expect(page.locator(".message-error")).toHaveCount(1);
  await page.getByRole("button", { name: "Previous version" }).click();
  await expect(hole(page)).toHaveAttribute("r", "7");
  await page.getByRole("button", { name: "Regenerate response" }).click();
  await expect(hole(page)).toHaveAttribute("r", "9");
  await page.getByText("Conversation history", { exact: true }).click();
  await expect(
    page
      .getByRole("navigation", { name: "Saved branches" })
      .getByRole("button"),
  ).toHaveCount(3);
});

test("refreshes a staged tool execution and resumes without applying the patch twice", async ({
  page,
}) => {
  await open(page);
  await send(page, "durable patch");
  await expect.poll(() => held).toBe(true);
  await expect(hole(page)).toHaveAttribute("r", "5");
  await page.reload();
  await page.getByRole("button", { name: "Continue from failed step" }).click();
  await expect(
    page.getByText("Durable patch completed", { exact: true }),
  ).toBeVisible();
  await expect(hole(page)).toHaveAttribute("r", "7");
  expect(
    requests.filter(
      (input) =>
        input.messages.filter((message: any) => message.role === "tool")
          .length === 1,
    ),
  ).toHaveLength(1);
  await expect(page.locator(".chat-message.assistant")).toHaveCount(2);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(hole(page)).toHaveAttribute("r", "5");
});

test("regenerates a new drawing from its blank snapshot and can return to the blank node", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("button", { name: "New Drawing", exact: true }).click();
  await send(page, "branch radius");
  await expect(hole(page)).toHaveAttribute("r", "7");
  await page.getByRole("button", { name: "Regenerate response" }).click();
  await expect(hole(page)).toHaveAttribute("r", "9");
  expect(requests[1].messages.at(-1).content[0].text).not.toContain(
    "Virtual source:",
  );
  await page
    .locator(".chat-message.user")
    .getByRole("button", { name: "Continue from here" })
    .click();
  await expect(page.locator(".empty-canvas")).toBeVisible();
  await page.getByText("Conversation history", { exact: true }).click();
  await page
    .getByRole("navigation", { name: "Saved branches" })
    .getByRole("button")
    .filter({ hasText: "Version radius 9" })
    .click();
  await expect(hole(page)).toHaveAttribute("r", "9");
});

test("persists a review proposal across refresh without committing it early", async ({
  page,
}) => {
  await open(page);
  await hole(page).click();
  await send(page, "branch radius");
  const review = page.getByRole("region", { name: "Review AI changes" });
  await expect(review).toBeVisible();
  await expect(hole(page)).toHaveAttribute("r", "7");
  await waitForProjectSave(page);
  expect(
    await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve) => {
        const request = indexedDB.open("draftline-projects", 1);
        request.onsuccess = () => resolve(request.result);
      });
      const project = await new Promise<any>((resolve) => {
        const request = db
          .transaction("projects")
          .objectStore("projects")
          .get("fixture-plate");
        request.onsuccess = () => resolve(request.result);
      });
      db.close();
      const message = project.messages.at(-1);
      return {
        status: message.status,
        radius: new DOMParser()
          .parseFromString(message.proposal.svg, "image/svg+xml")
          .getElementById("hole-top-left")
          ?.getAttribute("r"),
      };
    }),
  ).toEqual({ status: "reviewing", radius: "7" });
  await page.reload();
  await expect(review).toBeVisible();
  expect(
    await page
      .locator('iframe[title="Technical drawing preview"]')
      .evaluate((frame: HTMLIFrameElement) =>
        new DOMParser()
          .parseFromString(frame.srcdoc, "text/html")
          .getElementById("hole-top-left")
          ?.getAttribute("r"),
      ),
  ).toBe("7");
  await expect(hole(page)).toHaveAttribute("r", "7");
  await page
    .getByRole("button", { name: "Apply AI changes", exact: true })
    .click();
  await expect(review).toHaveCount(0);
  await expect(hole(page)).toHaveAttribute("r", "7");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(hole(page)).toHaveAttribute("r", "5");
});

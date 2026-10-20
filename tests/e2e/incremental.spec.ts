import { waitForProjectSave } from "../helpers/project-storage";
import { test, expect } from "../helpers/workspace-test";
import type { Page } from "@playwright/test";
import { createServer, type Server } from "node:http";
import {
  completeResponse,
  toolResponse,
  openCompletion,
  contentChunk,
  finishCompletion,
} from "../helpers/provider-stream";
import { inspectedHTML, radiusPatch } from "../helpers/source-patch";
import { EXAMPLE_SVG } from "../../src/lib/example";

let provider: Server;
let baseURL: string;
let requests: any[] = [];
let held = false;
let releaseActivity = () => {};
let activityStage = "";
let terminalAttempts = 0;
async function pauseActivity(
  res: import("node:http").ServerResponse,
  stage: string,
) {
  activityStage = stage;
  await new Promise<void>((resolve) => {
    releaseActivity = resolve;
    res.once("close", resolve);
  });
}
const tool = (id: string, name: string, args: unknown) => ({
  id,
  name,
  arguments: JSON.stringify(args),
});
test.beforeAll(async () => {
  provider = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const input = JSON.parse(body);
    requests.push(input);
    const instruction = input.messages.findLast((m: any) => m.role === "user")
      .content[0].text;
    const outputs = input.messages.filter((m: any) => m.role === "tool");
    const last = outputs.at(-1);
    const read = outputs.findLast((m: any) =>
      m.tool_call_id.startsWith("read"),
    );
    const result = last ? JSON.parse(last.content) : null;
    const revision = result?.revision;
    const patch = (id: string, text: string, rev = revision) =>
      toolResponse(res, [
        tool(id, "apply_patch", { revision: rev, patch: text }),
      ]);
    if (instruction.includes("source argument compatibility")) {
      if (!last) {
        toolResponse(res, [
          tool(
            "read-options",
            "read_source",
            instruction.includes("invalid")
              ? { file_path: "drawing.html", offset: 0, limit: 2000 }
              : {
                  file_path: "drawing.html",
                  offset: null,
                  limit: null,
                  element_id: null,
                },
          ),
        ]);
      } else if (!result.ok) {
        toolResponse(res, [
          tool("read-corrected", "read_source", {
            file_path: "drawing.html",
            offset: 1,
            limit: 80,
            element_id: null,
          }),
        ]);
      } else {
        completeResponse(
          res,
          JSON.stringify({
            kind: "message",
            message: "Source inspection complete.",
          }),
        );
      }
      return;
    }
    if (instruction.includes("activity progress")) {
      if (!last) {
        await pauseActivity(res, "submitted");
        openCompletion(res);
        const chunk = (tool_calls: unknown[]) =>
          res.write(
            `data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls }, finish_reason: null }] })}\n\n`,
          );
        chunk([
          {
            index: 0,
            id: "read0",
            function: { name: "read_source", arguments: "" },
          },
          {
            index: 1,
            id: "search0",
            function: { name: "search_source", arguments: "" },
          },
        ]);
        await pauseActivity(res, "arguments");
        chunk([
          {
            index: 0,
            function: {
              arguments: JSON.stringify({
                file_path: "drawing.html",
                element_id: "hole-top-left",
                limit: 200,
              }),
            },
          },
          {
            index: 1,
            function: {
              arguments: JSON.stringify({
                file_path: "drawing.html",
                query: "4 × Ø10",
              }),
            },
          },
        ]);
        finishCompletion(
          res,
          instruction.includes("disconnect") ? "length" : "tool_calls",
        );
        return;
      }
      if (last.tool_call_id === "search0")
        await pauseActivity(res, "inspected");
      if (last.tool_call_id === "missing") await pauseActivity(res, "failed");
      if (last.tool_call_id === "dimension")
        await pauseActivity(res, "validated");
    }
    if (!last) {
      toolResponse(res, [
        tool("read0", "read_source", {
          file_path: "drawing.html",
          element_id: "hole-top-left",
          limit: 200,
        }),
        tool("search0", "search_source", {
          file_path: "drawing.html",
          query: "4 × Ø10",
        }),
      ]);
    } else if (last.tool_call_id === "search0") {
      if (instruction.includes("inspect then ask")) {
        toolResponse(res, [
          tool("size", "request_user_input", {
            questions: [
              {
                id: "diameter",
                header: "Diameter",
                question: "What is the selected hole diameter?",
                options: [
                  {
                    label: "14 mm",
                    description: "Use your supplied diameter.",
                  },
                  {
                    label: "12 mm",
                    description: "Use your other supplied diameter.",
                  },
                ],
              },
            ],
          }),
        ]);
        return;
      }
      patch(
        "missing",
        "*** Begin Patch\n*** Update File: drawing.html\n@@\n-this line is absent\n+fixed\n*** End Patch",
      );
    } else if (last.tool_call_id === "size") {
      toolResponse(res, [
        tool("readAnswered", "read_source", {
          file_path: "drawing.html",
          element_id: "hole-top-left",
          limit: 200,
        }),
      ]);
    } else if (last.tool_call_id === "readAnswered") {
      patch(
        "good",
        radiusPatch(inspectedHTML(result.text), "hole-top-left", "7"),
      );
    } else if (last.tool_call_id === "missing") {
      patch(
        "scale",
        '*** Begin Patch\n*** Update File: drawing.html\n@@\n-      width="164mm"\n+      width="165mm"\n*** End Patch',
      );
    } else if (last.tool_call_id === "scale") {
      patch(
        "identity",
        '*** Begin Patch\n*** Update File: drawing.html\n@@\n-      id="hole-top-right"\n+      id="hole-top-left"\n*** End Patch',
      );
    } else if (last.tool_call_id === "identity") {
      patch(
        "stale",
        radiusPatch(
          inspectedHTML(JSON.parse(read.content).text),
          "hole-top-left",
          "7",
        ),
        "stale-revision",
      );
    } else if (last.tool_call_id === "stale") {
      patch(
        "ambiguous",
        '*** Begin Patch\n*** Update File: drawing.html\n@@\n-      r="5"\n+      r="7"\n*** End Patch',
      );
    } else if (last.tool_call_id === "ambiguous") {
      patch(
        "good",
        radiusPatch(
          inspectedHTML(JSON.parse(read.content).text),
          "hole-top-left",
          "7",
        ),
      );
    } else if (last.tool_call_id === "good") {
      if (instruction.includes("failed terminal")) {
        patch(
          "unresolved",
          "*** Begin Patch\n*** Update File: drawing.html\n@@\n-does not exist\n+bad\n*** End Patch",
        );
      } else {
        toolResponse(res, [
          tool("read1", "read_source", {
            file_path: "drawing.html",
            element_id: "hole-top-left",
            limit: 200,
          }),
        ]);
      }
    } else if (last.tool_call_id === "read1") {
      const line = inspectedHTML(result.text)
        .split("\n")
        .find((line) => line.includes("4 × Ø10"))!;
      patch(
        "dimension",
        `*** Begin Patch\n*** Update File: drawing.html\n@@\n-${line}\n+${line.replace("4 × Ø10", "Ø14; 3 × Ø10")}\n*** End Patch`,
      );
    } else if (instruction.includes("recover terminal")) {
      terminalAttempts++;
      if (terminalAttempts === 2 && instruction.includes("hold retry"))
        await pauseActivity(res, "terminal-retry");
      if (terminalAttempts <= (instruction.includes("manual") ? 3 : 1)) {
        if (instruction.includes("connection")) {
          openCompletion(res);
          contentChunk(res, '{"kind":"message","message":"Partial');
          res.end();
        } else
          completeResponse(res, "Finished placing and modifying the drawing.");
      } else {
        toolResponse(res, [
          tool("finish", "finish_drawing", {
            revision,
            summary: "Recovered drawing completion.",
          }),
        ]);
      }
    } else if (instruction.includes("stop staged")) {
      held = true;
      openCompletion(res);
      contentChunk(res, '{"kind":"message","message":"Finishing');
    } else {
      completeResponse(
        res,
        JSON.stringify({
          kind: "message",
          message: "Incremental edit complete.",
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

async function open(page: Page) {
  requests = [];
  held = false;
  activityStage = "";
  terminalAttempts = 0;
  await page.addInitScript((baseURL) => {
    if (window !== window.top) return;
    localStorage.setItem(
      "draftline-model",
      JSON.stringify({
        baseURL,
        apiKey: "incremental-test-key",
        model: "vision-test",
      }),
    );
  }, baseURL);
  await page.goto("/");
  const frame = page.frameLocator('iframe[title="Technical drawing preview"]');
  await expect(frame.locator("#hole-top-left")).toHaveAttribute("r", "5");
  await expect(frame.locator(".svg-pan-zoom_viewport")).toHaveCount(1);
  await frame.locator("#hole-top-left").click();
  await expect(
    page.getByText("SELECTED ELEMENT", { exact: true }),
  ).toBeVisible();
  return frame;
}
async function send(page: Page, text: string) {
  await page.getByLabel("Drawing instructions").fill(text);
  await page
    .getByRole("button", { name: "Send drawing instruction", exact: true })
    .click();
}

test("invalid final JSON recovers without replaying edits and applies as one undo step", async ({
  page,
}) => {
  const frame = await open(page);
  await send(page, "Resize to Ø14; recover terminal");
  await expect(
    page.getByText("Recovered drawing completion.", { exact: true }),
  ).toBeVisible();
  expect(terminalAttempts).toBe(2);
  expect(
    requests.at(-1).messages.filter((m: any) => m.role === "tool"),
  ).toEqual(requests.at(-2).messages.filter((m: any) => m.role === "tool"));
  await expect(frame.locator("#hole-top-left")).toHaveAttribute("r", "7");
  const activities = page.getByLabel("Agent activity");
  await activities.locator(".agent-history > summary").click();
  await expect(activities.locator('[data-activity-id="tool:6:0"]')).toHaveCount(
    1,
  );
  await expect(activities).toContainText("plain_text");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(frame.locator("#hole-top-left")).toHaveAttribute("r", "5");
  await expect(frame.locator("#dim-hole text")).toHaveText("4 × Ø10");
});

test("an interrupted final model connection retries only that model round", async ({
  page,
}) => {
  const frame = await open(page);
  await send(page, "Resize to Ø14; recover terminal connection");
  await expect(
    page.getByText("Recovered drawing completion.", { exact: true }),
  ).toBeVisible();
  expect(terminalAttempts).toBe(2);
  expect(
    requests.at(-1).messages.filter((m: any) => m.role === "tool"),
  ).toEqual(requests.at(-2).messages.filter((m: any) => m.role === "tool"));
  await expect(frame.locator("#hole-top-left")).toHaveAttribute("r", "7");
});

test("exhausted finalization preserves changes for manual continuation in the original project", async ({
  page,
}) => {
  const frame = await open(page);
  await send(page, "Resize to Ø14; recover terminal manual");
  const resume = page.getByRole("button", {
    name: "Continue from failed step",
    exact: true,
  });
  await expect(resume).toBeVisible();
  expect(terminalAttempts).toBe(3);
  await expect(frame.locator("#hole-top-left")).toHaveAttribute("r", "5");
  await page.getByRole("button", { name: "New Drawing", exact: true }).click();
  await expect(resume).toHaveCount(0);
  await page.getByLabel("Drawing instructions").fill("B draft");
  await page
    .getByRole("button", { name: "Open drawing Mounting plate", exact: true })
    .click();
  await resume.click();
  await expect(frame.locator("#hole-top-left")).toHaveAttribute("r", "7");
  expect(terminalAttempts).toBe(4);
  await expect(
    page
      .getByLabel("Agent activity")
      .last()
      .locator('[data-status="pending"], [data-status="running"]'),
  ).toHaveCount(0);
  expect(
    requests.at(-1).messages.filter((m: any) => m.role === "tool"),
  ).toEqual(requests.at(-2).messages.filter((m: any) => m.role === "tool"));
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(frame.locator("#hole-top-left")).toHaveAttribute("r", "5");
});

test("manual continuation rejects a changed base drawing before requesting the provider", async ({
  page,
}) => {
  const frame = await open(page);
  await send(page, "Resize to Ø14; recover terminal manual");
  await expect(
    page.getByRole("button", {
      name: "Continue from failed step",
      exact: true,
    }),
  ).toBeVisible();
  const count = requests.length;
  await page.getByRole("button", { name: "Code", exact: true }).click();
  await page
    .getByLabel("Drawing source code")
    .fill(
      `${EXAMPLE_SVG}<script>document.getElementById('hole-top-left').setAttribute('r','6')</script>`,
    );
  await page.getByRole("button", { name: "Apply code" }).click();
  await expect(frame.locator("#hole-top-left")).toHaveAttribute("r", "6");
  await page
    .getByRole("button", { name: "Continue from failed step", exact: true })
    .click();
  await expect(page.locator(".chat-message.assistant").last()).toContainText(
    "Revision conflict",
  );
  expect(requests).toHaveLength(count);
  await expect(frame.locator("#hole-top-left")).toHaveAttribute("r", "6");
});

test("automatic recovery stays with its originating project after navigation", async ({
  page,
}) => {
  const frame = await open(page);
  await send(page, "Resize to Ø14; recover terminal hold retry");
  await expect.poll(() => activityStage).toBe("terminal-retry");
  await page.getByRole("button", { name: "New Drawing", exact: true }).click();
  await page
    .getByLabel("Drawing instructions")
    .fill("Background recovery must preserve B");
  releaseActivity();
  await expect(page.locator(".project-open .spin")).toHaveCount(0);
  await expect(
    page.getByText("A fresh page for your next idea."),
  ).toBeVisible();
  await expect(page.getByLabel("Drawing instructions")).toHaveValue(
    "Background recovery must preserve B",
  );
  await page
    .getByRole("button", { name: "Open drawing Mounting plate", exact: true })
    .click();
  await expect(frame.locator("#hole-top-left")).toHaveAttribute("r", "7");
  expect(terminalAttempts).toBe(2);
});

test("active cancellation during recovery discards staged changes and never auto-resumes", async ({
  page,
}) => {
  const frame = await open(page);
  await send(page, "Resize to Ø14; recover terminal hold retry");
  await expect.poll(() => activityStage).toBe("terminal-retry");
  await expect(
    page.getByText("Steps succeeded — changes staged, not yet applied"),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Stop generation", exact: true })
    .click();
  await expect(page.getByText("Stopped", { exact: true })).toBeVisible();
  releaseActivity();
  await expect(frame.locator("#hole-top-left")).toHaveAttribute("r", "5");
  await expect(
    page.getByRole("button", {
      name: "Continue from failed step",
      exact: true,
    }),
  ).toHaveCount(0);
  expect(terminalAttempts).toBe(2);
});

test("source reads accept null options immediately and return actionable invalid-field feedback", async ({
  page,
}) => {
  const frame = await open(page);
  await send(page, "source argument compatibility");
  await expect(
    page.getByText("Source inspection complete.", { exact: true }),
  ).toBeVisible();
  expect(requests).toHaveLength(2);
  const firstFeedback = JSON.parse(
    requests[1].messages.find((message: any) => message.role === "tool")
      .content,
  );
  expect(firstFeedback.ok).toBe(true);
  const advertised = requests[0].tools.find(
    (entry: any) => entry.function.name === "read_source",
  ).function.parameters;
  expect(advertised.properties.element_id.anyOf).toContainEqual({
    type: "null",
  });
  expect(advertised.properties.limit.anyOf).toContainEqual({
    type: "integer",
    minimum: 1,
    maximum: 200,
  });
  await expect(
    page.getByLabel("Agent activity").locator('[data-status="failed"]'),
  ).toHaveCount(0);
  requests = [];
  await send(page, "source argument compatibility invalid");
  await expect(
    page.getByText("Source inspection complete.", { exact: true }),
  ).toHaveCount(2);
  const failed = JSON.parse(
    requests[1].messages.find((message: any) => message.role === "tool")
      .content,
  );
  expect(failed.ok).toBe(false);
  expect(failed.error).toContain("offset:");
  expect(failed.error).toContain("limit:");
  expect(
    JSON.parse(
      requests[2].messages
        .filter((message: any) => message.role === "tool")
        .at(-1).content,
    ).ok,
  ).toBe(true);
  const activity = page.getByLabel("Agent activity").last();
  await activity.locator(".agent-history > summary").click();
  await activity.locator('[data-status="failed"] > summary').click();
  await expect(activity.locator('[data-status="failed"]')).toContainText(
    "limit:",
  );
  await expect(frame.locator("#hole-top-left")).toHaveAttribute("r", "5");
});

test("activity is immediate, streams queued calls, shows failures and retries, and collapses completed work", async ({
  page,
}) => {
  const frame = await open(page);
  await send(page, "Resize selected hole to Ø14 with activity progress.");
  const activity = page.getByLabel("Agent activity");
  await expect(activity.locator('[data-activity-id="model:0"]')).toContainText(
    "Waiting for model response",
  );
  await expect.poll(() => activityStage).toBe("submitted");
  releaseActivity();
  await expect(
    activity.locator('[data-activity-id="tool:0:0"]'),
  ).toHaveAttribute("data-status", "pending");
  await expect(
    activity.locator('[data-activity-id="tool:0:1"]'),
  ).toHaveAttribute("data-status", "pending");
  await expect(frame.locator("#hole-top-left")).toHaveAttribute("r", "5");
  releaseActivity();
  await expect.poll(() => activityStage).toBe("inspected");
  await expect(
    activity.locator('[data-activity-id="model:1"]'),
  ).toHaveAttribute("data-status", "running");
  await activity.locator(".agent-history > summary").click();
  await expect(
    activity.locator('[data-activity-id="tool:0:0"]'),
  ).toHaveAttribute("data-status", "completed");
  await expect(
    activity.locator('[data-activity-id="tool:0:1"]'),
  ).toHaveAttribute("data-status", "completed");
  releaseActivity();
  await expect.poll(() => activityStage).toBe("failed");
  const failed = activity.locator('[data-activity-id="tool:1:0"]');
  await expect(failed).toHaveAttribute("data-status", "failed");
  await failed.locator("summary").click();
  await expect(failed).toContainText("Failed to find expected lines");
  await page.screenshot({ path: test.info().outputPath("activity-live.png") });
  releaseActivity();
  await expect.poll(() => activityStage, { timeout: 15000 }).toBe("validated");
  await expect(
    activity.getByText("Retrying failed modification", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    activity.locator(
      '[data-activity-id$=":validation"][data-status="completed"]',
    ),
  ).not.toHaveCount(0);
  await expect(frame.locator("#hole-top-left")).toHaveAttribute("r", "5");
  releaseActivity();
  await expect(
    page.getByText("Incremental edit complete.", { exact: true }),
  ).toBeVisible();
  await expect(activity.locator(".agent-history")).not.toHaveAttribute("open");
  await expect(activity.locator(".agent-history > summary")).toContainText(
    "failed",
  );
  await expect(activity.locator(".agent-history > summary")).toContainText(
    "retries",
  );
  await page.screenshot({
    path: test.info().outputPath("activity-complete.png"),
  });
  await activity.locator(".agent-history > summary").click();
  await expect(
    activity.locator('[data-activity-id="tool:1:0"]'),
  ).toHaveAttribute("data-status", "failed");
  await expect(frame.locator("#hole-top-left")).toHaveAttribute("r", "7");
  await waitForProjectSave(page);
  await page.reload();
  await expect(
    page.getByLabel("Agent activity").locator(".agent-history > summary"),
  ).toContainText("retries");
});

test("an interrupted streamed tool never executes and leaves no live activity", async ({
  page,
}) => {
  const frame = await open(page);
  await send(page, "activity progress disconnect");
  await expect.poll(() => activityStage).toBe("submitted");
  releaseActivity();
  const activity = page.getByLabel("Agent activity");
  await expect(
    activity.locator('[data-activity-id="tool:0:0"]'),
  ).toHaveAttribute("data-status", "pending");
  releaseActivity();
  await expect(
    page.getByRole("button", { name: "Send drawing instruction", exact: true }),
  ).toBeVisible();
  await expect(
    activity.locator('[data-status="running"], [data-status="pending"]'),
  ).toHaveCount(0);
  await expect(activity.locator(".agent-history > summary")).toContainText(
    "failed",
  );
  expect(requests).toHaveLength(1);
  await expect(frame.locator("#hole-top-left")).toHaveAttribute("r", "5");
});

test("stopping while tool arguments stream marks queued activities stopped, including after refresh", async ({
  page,
}) => {
  const frame = await open(page);
  await send(page, "activity progress cancel");
  await expect.poll(() => activityStage).toBe("submitted");
  releaseActivity();
  const activity = page.getByLabel("Agent activity");
  await expect(
    activity.locator('[data-activity-id="tool:0:0"]'),
  ).toHaveAttribute("data-status", "pending");
  await page.getByRole("button", { name: "Stop generation" }).click();
  await expect(
    activity.locator('[data-status="pending"], [data-status="running"]'),
  ).toHaveCount(0);
  await expect(activity.locator(".agent-history > summary")).toContainText(
    "stopped",
  );
  await expect(frame.locator("#hole-top-left")).toHaveAttribute("r", "5");
  await waitForProjectSave(page);
  await page.reload();
  await expect(
    page.getByLabel("Agent activity").locator(".agent-history > summary"),
  ).toContainText("stopped");
  expect(requests).toHaveLength(1);
});

test("real provider loop retries patch/validation/identity/revision errors, then synchronizes history, storage, code and export", async ({
  page,
}) => {
  const frame = await open(page);
  await send(page, "Resize selected hole to Ø14, recover all errors.");
  await expect(
    page.getByText("Incremental edit complete.", { exact: true }),
  ).toBeVisible();
  for (const output of requests
    .at(-1)
    .messages.filter(
      (m: any) =>
        m.role === "tool" && ["good", "dimension"].includes(m.tool_call_id),
    ))
    expect(JSON.parse(output.content), output.content).toHaveProperty(
      "ok",
      true,
    );
  await expect(frame.locator("#hole-top-left")).toHaveAttribute("r", "7");
  await expect(frame.locator("#hole-top-right")).toHaveAttribute("r", "5");
  await expect(frame.locator("#dim-hole text")).toHaveText("Ø14; 3 × Ø10");
  const outputs = requests
    .at(-1)
    .messages.filter((m: any) => m.role === "tool");
  const errors = outputs
    .map((m: any) => JSON.parse(m.content))
    .filter((r: any) => !r.ok)
    .map((r: any) => r.error);
  expect(errors).toEqual(
    expect.arrayContaining([
      expect.stringContaining("Failed to find expected lines"),
      expect.stringContaining("scale"),
      expect.stringContaining("unique"),
      expect.stringContaining("Revision conflict"),
      expect.stringContaining("Ambiguous"),
    ]),
  );
  expect(
    outputs.filter(
      (m: any) =>
        JSON.parse(m.content).ok &&
        ["good", "dimension"].includes(m.tool_call_id),
    ),
  ).toHaveLength(2);
  expect(requests[0].tools.map((t: any) => t.function.name)).toEqual([
    "request_user_input",
    "list_resources",
    "inspect_resource",
    "read_resource",
    "place_svg",
    "finish_drawing",
    "transform_object",
    "read_source",
    "search_source",
    "apply_patch",
  ]);
  for (const request of requests) {
    expect(request.stream).toBe(true);
    expect(JSON.stringify(request.messages)).not.toContain(
      "incremental-test-key",
    );
  }
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(frame.locator("#hole-top-left")).toHaveAttribute("r", "5");
  await expect(frame.locator("#dim-hole text")).toHaveText("4 × Ø10");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(frame.locator("#hole-top-left")).toHaveAttribute("r", "7");
  await page.getByRole("button", { name: "Code", exact: true }).click();
  await page.locator(".cm-scroller").evaluate((element) => {
    element.scrollTop = 1000;
  });
  await expect(page.locator(".cm-content")).toContainText('r="7"');
  await page.getByRole("button", { name: "Drawing", exact: true }).click();
  await waitForProjectSave(page);
  await page.reload();
  await expect(frame.locator("#hole-top-left")).toHaveAttribute("r", "7");
  await expect(frame.locator("#dim-hole text")).toHaveText("Ø14; 3 × Ø10");
  await page.getByRole("button", { name: "Export SVG" }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Geometry only" }).click();
  const { readFile } = await import("node:fs/promises");
  const exported = await readFile((await (await download).path())!, "utf8");
  expect(exported).toContain('r="7"');
  expect(exported).not.toContain('id="dimensions"');
  await page.getByRole("button", { name: "Code", exact: true }).click();
  await page
    .getByLabel("Drawing source code")
    .fill(
      `${EXAMPLE_SVG}<script>document.getElementById('hole-top-left').setAttribute('r','6');document.getElementById('plate-outline').setAttribute('width','125')</script>`,
    );
  await page.getByRole("button", { name: "Apply code" }).click();
  await expect(frame.locator("#hole-top-left")).toHaveAttribute("r", "6");
  await expect(frame.locator(".svg-pan-zoom_viewport")).toHaveCount(1);
  await frame.locator("#hole-top-left").click();
  await send(page, "Resize the manually edited selected hole to Ø14.");
  await expect(frame.locator("#hole-top-left")).toHaveAttribute("r", "7");
  await expect(frame.locator("#plate-outline")).toHaveAttribute("width", "125");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(frame.locator("#hole-top-left")).toHaveAttribute("r", "6");
  await expect(frame.locator("#plate-outline")).toHaveAttribute("width", "125");
});

test("inspection history and question tool IDs survive refresh before an incremental continuation", async ({
  page,
}) => {
  const frame = await open(page);
  await send(
    page,
    "Resize selected hole: inspect then ask whether to use my supplied 14 or 12 mm diameter.",
  );
  await expect(
    page.getByRole("heading", {
      name: "What is the selected hole diameter?",
      exact: true,
    }),
  ).toBeVisible();
  await waitForProjectSave(page);
  await page.reload();
  await expect(
    page.getByRole("heading", {
      name: "What is the selected hole diameter?",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Submit answers" }).click();
  await expect(frame.locator("#hole-top-left")).toHaveAttribute("r", "7");
  const resumed = requests.find((r) =>
    r.messages.some((m: any) => m.role === "tool" && m.tool_call_id === "size"),
  );
  expect(
    resumed.messages
      .filter((m: any) => m.role === "tool")
      .slice(0, 3)
      .map((m: any) => m.tool_call_id),
  ).toEqual(["read0", "search0", "size"]);
});

test("stopping after successful tools discards every staged change", async ({
  page,
}) => {
  const frame = await open(page);
  await send(page, "Resize to Ø14; stop staged");
  await expect.poll(() => held).toBe(true);
  await expect(frame.locator("#hole-top-left")).toHaveAttribute("r", "5");
  await expect(
    page.getByRole("button", { name: "New Drawing", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Stop generation" }).click();
  await expect(
    page.getByRole("button", { name: "New Drawing", exact: true }),
  ).toBeEnabled();
  await expect(frame.locator("#hole-top-left")).toHaveAttribute("r", "5");
  await page.reload();
  await expect(frame.locator("#hole-top-left")).toHaveAttribute("r", "5");
});

test("source tools, failure recovery and validation continue in the originating drawing after navigation", async ({
  page,
}) => {
  const frame = await open(page);
  await send(page, "Resize selected hole to Ø14 with activity progress.");
  await expect.poll(() => activityStage).toBe("submitted");
  await page.getByRole("button", { name: "New Drawing", exact: true }).click();
  await page.getByLabel("Drawing instructions").fill("Unsent B draft");
  releaseActivity();
  await expect.poll(() => activityStage).toBe("arguments");
  releaseActivity();
  await expect.poll(() => activityStage).toBe("inspected");
  releaseActivity();
  await expect.poll(() => activityStage).toBe("failed");
  releaseActivity();
  await expect.poll(() => activityStage, { timeout: 15000 }).toBe("validated");
  releaseActivity();
  await expect(page.locator(".project-open .spin")).toHaveCount(0);
  await expect(
    page.getByText("A fresh page for your next idea."),
  ).toBeVisible();
  await expect(page.getByLabel("Drawing instructions")).toHaveValue(
    "Unsent B draft",
  );
  await page
    .getByRole("button", { name: "Open drawing Mounting plate", exact: true })
    .click();
  await expect(frame.locator("#hole-top-left")).toHaveAttribute("r", "7");
  await expect(frame.locator("#dim-hole text")).toHaveText("Ø14; 3 × Ø10");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(frame.locator("#hole-top-left")).toHaveAttribute("r", "5");
});

test("a terminal answer with an unresolved failed patch preserves the committed drawing", async ({
  page,
}) => {
  const frame = await open(page);
  await send(page, "Resize to Ø14; failed terminal");
  await expect(
    page
      .getByText(
        "The edit was not completed successfully. Your drawing is unchanged.",
        { exact: false },
      )
      .first(),
  ).toBeVisible();
  await expect(frame.locator("#hole-top-left")).toHaveAttribute("r", "5");
  await expect(frame.locator("#dim-hole text")).toHaveText("4 × Ø10");
});

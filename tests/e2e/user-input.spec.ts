import { test, expect, type Page } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { EXAMPLE_SVG } from "../../src/lib/example";
import {
  completeResponse,
  toolResponse,
  openCompletion,
  contentChunk,
} from "../helpers/provider-stream";

const questions = {
  questions: [
    {
      id: "width",
      header: "Width",
      question: "What is the plate width?",
      options: [
        {
          label: "120 mm (Recommended)",
          description: "Use the proposed width.",
        },
        { label: "100 mm", description: "Use a narrower plate." },
      ],
    },
    {
      id: "height",
      header: "Height",
      question: "What is the plate height?",
      options: [
        { label: "80 mm", description: "Use the proposed height." },
        { label: "60 mm", description: "Use a shorter plate." },
      ],
    },
  ],
};
let provider: Server;
let baseURL: string;
let requests: any[] = [];
let failNext = false;
let holdNext = false;
let upstreamCancelled = false;
test.beforeAll(async () => {
  provider = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const input = JSON.parse(body);
    requests.push(input);
    if (input.messages.at(-1).role !== "tool") {
      const instruction = input.messages.at(-1).content[0].text;
      const calls = [
        { id: "call_dimensions", arguments: JSON.stringify(questions) },
      ];
      if (instruction.includes("queue"))
        calls.push({
          id: "call_second",
          arguments: JSON.stringify({ questions: [questions.questions[0]] }),
        });
      toolResponse(res, calls);
      return;
    }
    if (failNext) {
      failNext = false;
      res.writeHead(503);
      res.end("{}");
      return;
    }
    if (holdNext) {
      holdNext = false;
      openCompletion(res);
      contentChunk(res, '{"kind":"message","message":"Resuming drawing');
      res.once("close", () => {
        upstreamCancelled = true;
      });
      return;
    }
    if (
      input.messages.filter((m: any) => m.role === "tool").length === 1 &&
      input.messages
        .findLast((m: any) => m.role === "user")
        .content[0].text.includes("follow-up")
    ) {
      toolResponse(res, [
        {
          id: "call_followup",
          arguments: JSON.stringify({ questions: [questions.questions[0]] }),
        },
      ]);
      return;
    }
    const selected = input.messages
      .findLast((m: any) => m.role === "user")
      .content[0].text.includes("Selected element: hole-top-left");
    completeResponse(
      res,
      JSON.stringify(
        selected
          ? {
              kind: "patch",
              summary: "Updated the chosen hole after clarification.",
              patches: [
                {
                  id: "hole-top-left",
                  svg: '<circle id="hole-top-left" cx="20" cy="20" r="7" fill="white" />',
                },
              ],
            }
          : {
              kind: "drawing",
              title: "Clarified plate",
              summary: "Created the plate from your answers.",
              notes: [],
              html: EXAMPLE_SVG,
            },
      ),
    );
  });
  await new Promise<void>((resolve) =>
    provider.listen(0, "127.0.0.1", resolve),
  );
  baseURL = `http://127.0.0.1:${(provider.address() as { port: number }).port}/v1`;
});
test.afterAll(
  () => new Promise<void>((resolve) => provider.close(() => resolve())),
);
test.beforeEach(() => {
  requests = [];
  failNext = false;
  holdNext = false;
  upstreamCancelled = false;
});
async function setup(
  page: Page,
  instruction = "Draw a plate; ask for dimensions",
) {
  await page.addInitScript(
    (config) => localStorage.setItem("draftline-model", JSON.stringify(config)),
    {
      baseURL,
      apiKey: "browser-test-key",
      model: "vision-test",
    },
  );
  await page.goto("/");
  await page.getByRole("button", { name: "New Drawing", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "A fresh page for your next idea." }),
  ).toBeVisible();
  await page.getByLabel("Drawing instructions").fill(instruction);
  await page.getByRole("button", { name: "Send drawing instruction" }).click();
  await expect(
    page.getByRole("region", { name: "Question from assistant" }),
  ).toBeVisible();
}
const panel = (page: Page) =>
  page.getByRole("region", { name: "Question from assistant" });

test("custom answers, previous-question editing, persisted drafts and automatic drawing continuation", async ({
  page,
}) => {
  await setup(page);
  await expect(page.getByLabel("Drawing instructions")).toHaveCount(0);
  expect(requests).toHaveLength(1);
  await page.screenshot({ path: ".generated/request-user-input-desktop.png" });
  await panel(page)
    .getByRole("radio", { name: /None of the above/ })
    .click();
  await page.getByLabel("Answer notes").fill("123 mm wide");
  await panel(page)
    .getByRole("button", { name: "Submit answer", exact: true })
    .click();
  await panel(page).getByRole("radio", { name: /60 mm/ }).click();
  await panel(page).getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByLabel("Answer notes")).toHaveValue("123 mm wide");
  await page.getByLabel("Answer notes").fill("120 mm wide");
  await panel(page)
    .getByRole("button", { name: "Submit answer", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve) => {
          const r = indexedDB.open("draftline-projects");
          r.onsuccess = () => resolve(r.result);
        });
        return new Promise<number>((resolve) => {
          const r = db.transaction("projects").objectStore("projects").getAll();
          r.onsuccess = () => {
            resolve(
              r.result.find((p: any) => p.userInput)?.userInput.state.index ??
                -1,
            );
            db.close();
          };
        });
      }),
    )
    .toBe(1);
  await page.reload();
  await expect(
    panel(page).getByRole("heading", { name: "What is the plate height?" }),
  ).toBeVisible();
  await expect(
    panel(page).getByRole("radio", { name: /60 mm/ }),
  ).toHaveAttribute("aria-checked", "true");
  await panel(page)
    .getByRole("button", { name: "Submit answers", exact: true })
    .click();
  await expect(panel(page)).toHaveCount(0);
  // The panel closes when continuation starts. Wait for the sandbox commit;
  // its own failure timeout is six seconds, longer than the default assertion.
  await expect(
    page.getByRole("button", { name: "Stop generation", exact: true }),
  ).toHaveCount(0, { timeout: 8000 });
  const frame = page.frameLocator('iframe[title="Technical drawing preview"]');
  await expect(frame.locator("#plate-outline")).toBeVisible();
  expect(requests).toHaveLength(2);
  const tool = requests[1].messages.at(-1);
  expect(tool.role).toBe("tool");
  expect(tool.tool_call_id).toBe("call_dimensions");
  expect(JSON.parse(tool.content)).toEqual({
    answers: {
      width: { answers: ["None of the above", "user_note: 120 mm wide"] },
      height: { answers: ["60 mm"] },
    },
  });
  await expect(page.getByLabel("Drawing instructions")).toBeVisible();
  await expect(
    page.getByText("Created the plate from your answers."),
  ).toBeVisible();
});

test("keyboard navigation, unanswered confirmation and queued calls do not submit uncommitted defaults", async ({
  page,
}) => {
  await setup(page, "Draw a plate; queue questions");
  await panel(page).focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect(
    panel(page).getByText("Submit with unanswered questions?"),
  ).toBeVisible();
  await panel(page)
    .getByRole("button", { name: "Go back", exact: true })
    .click();
  await expect(
    panel(page).getByRole("heading", { name: "What is the plate width?" }),
  ).toBeVisible();
  await panel(page).getByRole("button", { name: "Next", exact: true }).click();
  await panel(page)
    .getByRole("button", { name: "Submit answers", exact: true })
    .click();
  await panel(page)
    .getByRole("button", { name: "Proceed", exact: true })
    .click();
  expect(requests).toHaveLength(1);
  await expect(
    panel(page).getByRole("heading", { name: "What is the plate width?" }),
  ).toBeVisible();
  await panel(page)
    .getByRole("radio", { name: /120 mm/ })
    .focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(panel(page)).toHaveCount(0);
  await expect.poll(() => requests.length).toBe(2);
  const tools = requests[1].messages.filter((m: any) => m.role === "tool");
  expect(tools.map((m: any) => m.tool_call_id)).toEqual([
    "call_dimensions",
    "call_second",
  ]);
  expect(JSON.parse(tools[0].content).answers.width.answers).toEqual([]);
  expect(JSON.parse(tools[1].content).answers.width.answers).toEqual([
    "100 mm",
  ]);
});

test("failed and stopped continuation restores questions and can retry; selected edits preserve other geometry", async ({
  page,
}) => {
  await page.addInitScript(
    (config) => localStorage.setItem("draftline-model", JSON.stringify(config)),
    { baseURL, apiKey: "test", model: "vision-test" },
  );
  await page.goto("/");
  const frame = page.frameLocator('iframe[title="Technical drawing preview"]');
  await frame.locator("#hole-top-left").click();
  await page
    .getByLabel("Drawing instructions")
    .fill("Edit this hole after clarifying");
  await page.getByRole("button", { name: "Send drawing instruction" }).click();
  await expect(panel(page)).toBeVisible();
  await panel(page)
    .getByRole("button", { name: "Submit answer", exact: true })
    .click();
  failNext = true;
  await panel(page)
    .getByRole("button", { name: "Submit answers", exact: true })
    .click();
  await expect(panel(page)).toBeVisible();
  await expect(frame.locator("#hole-top-left")).toHaveAttribute("r", "5");
  holdNext = true;
  await panel(page)
    .getByRole("button", { name: "Submit answers", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Stop generation", exact: true }),
  ).toBeVisible();
  // Cancellation must be tested after the fixture has actually started its stream.
  await expect(
    page.getByText("Resuming drawing", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Stop generation", exact: true })
    .click();
  await expect(panel(page)).toBeVisible();
  await expect.poll(() => upstreamCancelled).toBe(true);
  holdNext = true;
  await panel(page)
    .getByRole("button", { name: "Submit answers", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Stop generation", exact: true }),
  ).toBeVisible();
  await expect.poll(() => requests.length).toBe(4);
  await page.reload();
  await expect(panel(page)).toBeVisible();
  expect(requests).toHaveLength(4);
  await panel(page)
    .getByRole("button", { name: "Submit answers", exact: true })
    .click();
  await expect(frame.locator("#hole-top-left")).toHaveAttribute("r", "7");
  await expect(frame.locator("#hole-top-right")).toHaveAttribute("r", "5");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(frame.locator("#hole-top-left")).toHaveAttribute("r", "5");
});

test("pending questions are isolated per project, cancellable, and usable on a narrow screen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await panel(page)
    .getByRole("radio", { name: /None of the above/ })
    .click();
  await page.getByLabel("Answer notes").fill("My custom width");
  for (let i = 0; i < 3; i++) {
    await page
      .getByRole("button", { name: "New Drawing", exact: true })
      .click();
    await expect(panel(page)).toHaveCount(0);
    // A render/save racing the switch must not drop the newly inserted project.
    await expect(
      page.getByRole("button", { name: /^Open drawing / }),
    ).toHaveCount(3 + i);
    await page
      .getByRole("button", {
        name: "Open drawing Untitled drawing",
        exact: true,
      })
      .last()
      .click();
    await expect(page.getByLabel("Answer notes")).toHaveValue(
      "My custom width",
    );
  }
  expect(
    await panel(page).evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
  await page.getByLabel("Answer notes").press("Escape");
  await expect(page.getByLabel("Answer notes")).toHaveCount(0);
  await page.setViewportSize({ width: 900, height: 850 });
  await expect(panel(page)).toBeVisible();
  expect(
    await panel(page).evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
  await page.screenshot({
    path: ".generated/request-user-input-tablet.png",
    fullPage: true,
  });
  await panel(page).getByRole("button", { name: "Cancel questions" }).click();
  await expect(page.getByLabel("Drawing instructions")).toBeVisible();
  expect(requests).toHaveLength(1);
});

test("the model can ask a follow-up tool question and resume with both rounds", async ({
  page,
}) => {
  await setup(page, "Draw a plate; ask a follow-up");
  await panel(page)
    .getByRole("button", { name: "Submit answer", exact: true })
    .click();
  await panel(page)
    .getByRole("button", { name: "Submit answers", exact: true })
    .click();
  await expect(
    panel(page).getByRole("heading", { name: "What is the plate width?" }),
  ).toBeVisible();
  await expect(panel(page).getByText("1 / 1", { exact: true })).toBeVisible();
  await panel(page)
    .getByRole("button", { name: "Submit answers", exact: true })
    .click();
  await expect(
    page
      .frameLocator('iframe[title="Technical drawing preview"]')
      .locator("#plate-outline"),
  ).toBeVisible();
  expect(requests).toHaveLength(3);
  expect(
    requests[2].messages
      .filter((m: any) => m.role === "tool")
      .map((m: any) => m.tool_call_id),
  ).toEqual(["call_dimensions", "call_followup"]);
});

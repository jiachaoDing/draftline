import { test, expect, type Page } from "@playwright/test";
import { createServer, type Server } from "node:http";
import {
  completeResponse,
  toolResponse,
  openCompletion,
  contentChunk,
} from "../helpers/provider-stream";
import { inspectedHTML, radiusPatch } from "../helpers/source-patch";
import { EXAMPLE_SVG } from "../../src/lib/example";

let provider: Server;
let baseURL: string;
let requests: any[] = [];
let held = false;
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
        "scope",
        radiusPatch(
          inspectedHTML(JSON.parse(read.content).text),
          "hole-top-right",
          "9",
        ),
      );
    } else if (last.tool_call_id === "scope") {
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

test("real provider loop retries patch/validation/scope/revision errors, then synchronizes history, storage, code and export", async ({
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
      expect.stringContaining("unrelated"),
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
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
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
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
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
  ).toBeDisabled();
  await page.getByRole("button", { name: "Stop generation" }).click();
  await expect(
    page.getByRole("button", { name: "New Drawing", exact: true }),
  ).toBeEnabled();
  await expect(frame.locator("#hole-top-left")).toHaveAttribute("r", "5");
  await page.reload();
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

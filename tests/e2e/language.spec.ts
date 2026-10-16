import { test, expect } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { completeResponse, toolResponse } from "../helpers/provider-stream";
import { EXAMPLE_SVG } from "../../src/lib/example";

let provider: Server;
let baseURL: string;
let requests: {
  messages: { role: string; content: unknown; tool_call_id?: string }[];
}[] = [];

test.beforeAll(async () => {
  provider = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const input = JSON.parse(body);
    requests.push(input);
    if (input.messages.at(-1).role !== "tool") {
      toolResponse(res, [
        {
          id: "dimensions_zh",
          arguments: JSON.stringify({
            questions: [
              {
                id: "width",
                header: "宽度",
                question: "请确认板件宽度",
                options: [{ label: "120 mm", description: "使用此宽度" }],
              },
            ],
          }),
        },
      ]);
    } else {
      completeResponse(
        res,
        JSON.stringify({
          kind: "drawing",
          title: "中文测试图纸",
          summary: "已生成图纸。",
          notes: [],
          html: EXAMPLE_SVG,
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
test.beforeEach(() => {
  requests = [];
});

test("language switching preserves drafts, drawing content, editor state and saved preference", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".saved-indicator")).toHaveText("Saved locally");
  await page
    .getByLabel("Drawing instructions")
    .fill("保留这个草稿 Keep this draft");
  await page.getByRole("button", { name: "Code", exact: true }).click();
  const source = await page
    .getByRole("textbox", { name: "Drawing source code" })
    .innerText();
  await page
    .getByRole("combobox", { name: "Language", exact: true })
    .selectOption("zh-CN");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(page.getByRole("textbox", { name: "图纸源代码" })).toHaveText(
    source,
    { useInnerText: true },
  );
  await expect(
    page.getByRole("button", { name: "模型设置", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("绘图指令", { exact: true })).toHaveValue(
    "保留这个草稿 Keep this draft",
  );
  await expect(page.locator(".project-title")).toHaveText("Mounting plate");
  await page
    .getByLabel("绘图指令", { exact: true })
    .dispatchEvent("keydown", { key: "Enter", isComposing: true });
  await expect(page.locator(".settings-dialog")).toHaveCount(0);
  await expect(page.getByLabel("绘图指令", { exact: true })).toHaveValue(
    "保留这个草稿 Keep this draft",
  );
  await page.reload();
  await expect(
    page.getByRole("combobox", { name: "语言", exact: true }),
  ).toHaveValue("zh-CN");
  await expect(page.getByLabel("绘图指令", { exact: true })).toHaveValue(
    "保留这个草稿 Keep this draft",
  );
  await page.getByRole("button", { name: "新建图纸", exact: true }).click();
  await expect(page.locator(".project-title")).toHaveText("未命名图纸");
  await page
    .getByRole("combobox", { name: "语言", exact: true })
    .selectOption("en");
  await expect(
    page.getByRole("button", { name: "New Drawing", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".project-title")).toHaveText("未命名图纸");
});

test("Chinese questions survive refresh and resume through the provider with matching tool IDs", async ({
  page,
}) => {
  await page.addInitScript((url) => {
    localStorage.setItem("draftline-language", "zh-CN");
    localStorage.setItem(
      "draftline-model",
      JSON.stringify({
        baseURL: url,
        apiKey: "language-test-key",
        model: "vision-test",
      }),
    );
  }, baseURL);
  await page.goto("/");
  await page
    .getByLabel("绘图指令", { exact: true })
    .fill("请绘制板件，先确认尺寸");
  await page.getByRole("button", { name: "发送绘图指令" }).click();
  await expect(page.getByRole("region", { name: "助手追问" })).toBeVisible();
  expect(requests[0].messages[0].content).toContain("Simplified Chinese");
  await page.getByRole("radio", { name: /自定义回答/ }).click();
  await page
    .getByLabel("自定义回答", { exact: true })
    .fill("120 mm，保持其他尺寸");
  await expect(page.locator(".saved-indicator")).toHaveText("已保存到本地");
  await page.reload();
  await expect(page.getByLabel("自定义回答", { exact: true })).toHaveValue(
    "120 mm，保持其他尺寸",
  );
  expect(requests).toHaveLength(1);
  await page.getByRole("button", { name: "提交所有回答" }).click();
  await expect(page.locator(".project-title")).toHaveText("中文测试图纸");
  expect(requests).toHaveLength(2);
  expect(requests[1].messages[0].content).toContain("Simplified Chinese");
  expect(requests[1].messages.at(-1)).toMatchObject({
    role: "tool",
    tool_call_id: "dimensions_zh",
  });
  expect(requests[1].messages.at(-1)?.content).toContain(
    "120 mm，保持其他尺寸",
  );
  await page.getByRole("button", { name: "导出 SVG" }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /仅几何图形/ }).click();
  expect((await download).suggestedFilename()).toBe("中文测试图纸.svg");
});

test.describe("Chinese browser preference", () => {
  test.use({ locale: "zh-CN", viewport: { width: 390, height: 844 } });
  test("selects Chinese automatically and keeps the mobile language control in view", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(
      page.getByRole("combobox", { name: "语言", exact: true }),
    ).toHaveValue("zh-CN");
    await expect(
      page.getByRole("button", { name: "模型设置", exact: true }),
    ).toBeInViewport();
    await expect(
      page.getByRole("button", { name: "导出 SVG" }),
    ).toBeInViewport();
    const bounds = await page.locator(".app-header").evaluate((header) => ({
      scroll: header.scrollWidth,
      width: header.clientWidth,
    }));
    expect(bounds.scroll).toBeLessThanOrEqual(bounds.width);
    await page.setViewportSize({ width: 320, height: 568 });
    await expect(
      page.getByRole("combobox", { name: "语言", exact: true }),
    ).toBeInViewport();
    await expect(
      page.getByRole("button", { name: "导出 SVG" }),
    ).toBeInViewport();
    const narrowBounds = await page
      .locator(".app-header")
      .evaluate((header) => ({
        scroll: header.scrollWidth,
        width: header.clientWidth,
      }));
    expect(narrowBounds.scroll).toBeLessThanOrEqual(narrowBounds.width);
    await page
      .getByRole("combobox", { name: "语言", exact: true })
      .selectOption("en");
    await page.reload();
    await expect(
      page.getByRole("combobox", { name: "Language", exact: true }),
    ).toHaveValue("en");
  });
});

import { createServer, type Server } from "node:http";
import { test, expect } from "../helpers/workspace-test";
import { completeResponse } from "../helpers/provider-stream";

let provider: Server;
let baseURL: string;
const requests: Array<{
  path?: string;
  authorization?: string;
  body: { model: string; reasoning_effort?: string };
}> = [];

test.beforeAll(async () => {
  provider = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push({
      path: req.url,
      authorization: req.headers.authorization,
      body: JSON.parse(body),
    });
    completeResponse(
      res,
      '{"kind":"message","message":"Shared settings request received."}',
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

test("different share links apply their own settings and work through the real provider", async ({
  page,
  browser,
}) => {
  let copiedLink = "";
  await page.exposeFunction("captureSettingsLink", (link: string) => {
    copiedLink = link;
  });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: (link: string) =>
          (
            window as typeof window & {
              captureSettingsLink: (link: string) => Promise<void>;
            }
          ).captureSettingsLink(link),
      },
    });
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Model settings", exact: true })
    .click();
  const copy = page.getByRole("button", {
    name: "Copy share link",
    exact: true,
  });
  await expect(copy).toBeDisabled();
  await page.getByLabel("Base URL", { exact: true }).fill(baseURL);
  await page.getByLabel("API key", { exact: true }).fill("share-key-a");
  await page
    .getByRole("combobox", { name: "Model", exact: true })
    .fill("shared-model-a");
  await page.getByLabel("API key", { exact: true }).click();
  await page
    .locator("summary")
    .filter({ hasText: "Advanced settings" })
    .click();
  await page
    .getByLabel("Reasoning effort", { exact: true })
    .selectOption("low");
  await copy.click();
  await expect(
    page.getByText("Share link copied.", { exact: true }),
  ).toBeVisible();
  const firstLink = copiedLink;
  expect(new URL(firstLink).search).toBe("");
  expect(new URL(firstLink).hash).toMatch(/^#model-settings=/);
  expect(
    await page.evaluate(() => localStorage.getItem("draftline-model")),
  ).toBeNull();

  await page
    .getByLabel("Base URL", { exact: true })
    .fill(baseURL.replace("/v1", "/other/v1"));
  await expect(
    page.getByText("Share link copied.", { exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("API key", { exact: true }).fill("share-key-b");
  await page
    .getByRole("combobox", { name: "Model", exact: true })
    .fill("shared-model-b");
  await page.getByLabel("API key", { exact: true }).click();
  await copy.click();
  await expect(
    page.getByText("Share link copied.", { exact: true }),
  ).toBeVisible();
  const secondLink = copiedLink;
  expect(secondLink).not.toBe(firstLink);

  const recipient = await browser.newContext();
  await recipient.addInitScript(() => {
    if (window === window.top) localStorage.setItem("draftline-language", "en");
  });
  const friend = await recipient.newPage();
  const requestURLs: string[] = [];
  friend.on("request", (request) => requestURLs.push(request.url()));
  try {
    const before = requests.length;
    await friend.goto(firstLink);
    await expect(
      friend.getByText("Shared model settings loaded. You can start drawing.", {
        exact: true,
      }),
    ).toBeVisible();
    expect(new URL(friend.url()).hash).toBe("");
    expect(requests.length).toBe(before);
    expect(
      requestURLs.every(
        (url) =>
          !url.includes("model-settings=") && !url.includes("share-key-a"),
      ),
    ).toBe(true);
    await friend.reload();
    await friend
      .getByLabel("Drawing instructions", { exact: true })
      .fill("Reply with a short message.");
    await friend
      .getByRole("button", { name: "Send drawing instruction", exact: true })
      .click();
    await expect(
      friend.getByText("Shared settings request received.", { exact: true }),
    ).toBeVisible();
    expect(requests.at(-1)).toMatchObject({
      path: "/v1/chat/completions",
      authorization: "Bearer share-key-a",
      body: { model: "shared-model-a", reasoning_effort: "low" },
    });
    const storedProjects = await friend.evaluate(async () => {
      return new Promise<string>((resolve, reject) => {
        const request = indexedDB.open("draftline-projects", 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const records = database
            .transaction("projects")
            .objectStore("projects")
            .getAll();
          records.onsuccess = () => {
            database.close();
            resolve(JSON.stringify(records.result));
          };
          records.onerror = () => {
            database.close();
            reject(records.error);
          };
        };
      });
    });
    expect(storedProjects).not.toContain("share-key-a");
    expect(storedProjects).not.toContain(baseURL);

    // Changing only the fragment must also import without a document reload.
    await friend.goto(secondLink);
    await expect(
      friend.getByRole("button", { name: "shared-model-b", exact: true }),
    ).toBeVisible();
    expect(new URL(friend.url()).hash).toBe("");
    await friend
      .getByRole("button", { name: "Model settings", exact: true })
      .click();
    await expect(friend.getByLabel("Base URL", { exact: true })).toHaveValue(
      baseURL.replace("/v1", "/other/v1"),
    );
    await expect(friend.getByLabel("API key", { exact: true })).toHaveValue(
      "share-key-b",
    );
    await friend
      .getByRole("button", { name: "Test connection", exact: true })
      .click();
    await expect(
      friend.getByText(
        "Connected. Your selected model responded successfully.",
        { exact: true },
      ),
    ).toBeVisible();
    expect(requests.at(-1)).toMatchObject({
      path: "/other/v1/chat/completions",
      authorization: "Bearer share-key-b",
      body: { model: "shared-model-b" },
    });
    await friend.goto(firstLink);
    await expect(
      friend.getByRole("button", { name: "shared-model-a", exact: true }),
    ).toBeVisible();
  } finally {
    await recipient.close();
  }
});

test("invalid share links clear the URL and preserve saved settings", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() =>
    localStorage.setItem(
      "draftline-model",
      JSON.stringify({
        baseURL: "https://saved.example/v1",
        apiKey: "saved-test-key",
        model: "saved-model",
      }),
    ),
  );
  await page.reload();
  await page.goto("/#model-settings=broken");
  await expect(
    page.getByText(
      "This model settings link is invalid or incomplete. Ask the sender for a new link.",
      { exact: true },
    ),
  ).toBeVisible();
  expect(new URL(page.url()).hash).toBe("");
  await page
    .getByRole("button", { name: "Model settings", exact: true })
    .click();
  await expect(page.getByLabel("API key", { exact: true })).toHaveValue(
    "saved-test-key",
  );
  await expect(
    page.getByRole("combobox", { name: "Model", exact: true }),
  ).toHaveValue("saved-model");
});

test.describe("Chinese mobile sharing", () => {
  test.use({
    workspaceLanguage: "zh-CN",
    viewport: { width: 390, height: 640 },
  });
  test("clipboard failure offers a selectable link and edits clear it", async ({
    page,
  }) => {
    await page.addInitScript(() =>
      Object.defineProperty(navigator, "clipboard", {
        value: {
          writeText: async () => {
            throw new Error("Clipboard denied");
          },
        },
      }),
    );
    await page.goto("/");
    await page.getByRole("button", { name: "展开侧栏" }).click();
    await page.getByRole("button", { name: "模型设置", exact: true }).click();
    await page
      .getByLabel("接口地址", { exact: true })
      .fill("https://shared.example/v1");
    await page.getByLabel("API 密钥", { exact: true }).fill("mobile-share-key");
    await page
      .getByRole("combobox", { name: "模型", exact: true })
      .fill("mobile-model");
    await page.getByLabel("API 密钥", { exact: true }).click();
    await page
      .getByRole("button", { name: "复制分享链接", exact: true })
      .click();
    await expect(
      page.getByText("无法访问剪贴板，请选中并复制下方链接。", { exact: true }),
    ).toBeVisible();
    const link = page.getByLabel("模型设置分享链接", { exact: true });
    await link.click();
    expect(
      await link.evaluate(
        (input: HTMLInputElement) =>
          input.selectionEnd! - input.selectionStart!,
      ),
    ).toBe((await link.inputValue()).length);
    const dialog = (await page.getByRole("dialog").boundingBox())!;
    expect(dialog.x).toBeGreaterThanOrEqual(0);
    expect(dialog.x + dialog.width).toBeLessThanOrEqual(390);
    await page.getByLabel("API 密钥", { exact: true }).fill("changed-key");
    await expect(link).toHaveCount(0);
    await page.getByRole("button", { name: "保存设置", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});

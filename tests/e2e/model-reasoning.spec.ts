import { createServer, type Server } from "node:http";
import { test, expect } from "../helpers/workspace-test";
import { completeResponse } from "../helpers/provider-stream";

let provider: Server;
let baseURL: string;
const requests: Array<{ model: string; reasoning_effort?: string }> = [];

test.beforeAll(async () => {
  provider = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push(JSON.parse(body));
    completeResponse(
      res,
      '{"kind":"message","message":"Reasoning setting received."}',
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

test("reasoning defaults, explicit choices, persistence and provider payload stay consistent", async ({
  page,
}) => {
  await page.addInitScript(
    ({ baseURL }) => {
      if (window === window.top && !localStorage.getItem("draftline-model"))
        localStorage.setItem(
          "draftline-model",
          JSON.stringify({
            baseURL,
            apiKey: "reasoning-test-key",
            model: "gpt-6.1-sol",
          }),
        );
    },
    { baseURL },
  );
  await page.goto("/");
  await page
    .getByRole("button", { name: "Model settings", exact: true })
    .click();
  const effort = page.getByLabel("Reasoning effort", { exact: true });
  await expect(effort).toHaveValue("auto");
  await expect(effort.locator("option:checked")).toHaveText(
    "Automatic (High (high))",
  );
  await page
    .getByRole("button", { name: "Test connection", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Connected.");
  expect(requests.at(-1)?.reasoning_effort).toBe("high");
  await effort.selectOption("low");
  await page
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await page.reload();
  await page
    .getByRole("button", { name: "Model settings", exact: true })
    .click();
  await expect(effort).toHaveValue("low");
  await page
    .getByRole("button", { name: "Test connection", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Connected.");
  expect(requests.at(-1)?.reasoning_effort).toBe("low");
  await effort.selectOption("provider");
  await page
    .getByRole("button", { name: "Test connection", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Connected.");
  expect(requests.at(-1)).not.toHaveProperty("reasoning_effort");
  await page.setViewportSize({ width: 390, height: 700 });
  await effort.selectOption("high");
  await page
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await page
    .getByLabel("Drawing instructions", { exact: true })
    .fill("Reply with a short message.");
  await page
    .getByRole("button", { name: "Send drawing instruction", exact: true })
    .click();
  await expect(
    page.getByText("Reasoning setting received.", { exact: true }),
  ).toBeVisible();
  expect(requests.at(-1)?.reasoning_effort).toBe("high");
  expect(requests.every((request) => request.model === "gpt-6.1-sol")).toBe(
    true,
  );
});

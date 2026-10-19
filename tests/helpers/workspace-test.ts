import { test as base, expect } from "@playwright/test";
import { EXAMPLE_SVG } from "../../src/lib/example";

// Editing/provider regressions use a small, explicit drawing fixture. Startup
// samples are exercised separately without this fixture in starter-projects.spec.
export const test = base.extend<{ workspaceLanguage: "en" | "zh-CN" }>({
  workspaceLanguage: ["en", { option: true }],
  page: async ({ page, workspaceLanguage }, use) => {
    await page.addInitScript(
      ({ svg, language }) => {
        if (window !== window.top) return;
        if (!localStorage.getItem("draftline-language"))
          localStorage.setItem("draftline-language", language);
        const request = indexedDB.open("draftline-projects", 1);
        request.onupgradeneeded = () => {
          const database = request.result;
          const store = database.createObjectStore("projects", {
            keyPath: "id",
          });
          database.createObjectStore("meta");
          store.add({
            id: "fixture-plate",
            name: "Mounting plate",
            renamed: false,
            createdAt: 1,
            updatedAt: 1,
            history: {
              items: [
                {
                  title: "Mounting plate",
                  svg,
                  summary: "Test plate",
                  notes: [],
                },
              ],
              index: 0,
            },
            messages: [
              {
                role: "assistant",
                text: "Describe a part with its dimensions, or attach a reference sketch. I’ll create your drawing, then help you refine it.",
              },
            ],
            sketch: null,
            attachments: [],
            chatInput: "",
            clarification: null,
            userInput: null,
            layers: { geometry: true, dimensions: true, presentation: true },
          });
        };
        request.onsuccess = () => request.result.close();
      },
      { svg: EXAMPLE_SVG, language: workspaceLanguage },
    );
    await use(page);
  },
});

export { expect };

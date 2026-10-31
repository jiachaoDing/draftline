import { expect, type Page } from "@playwright/test";

/** Install drawing test data through validation and persistence, then reopen it. */
export async function installDrawingFixture(page: Page, source: string) {
  await waitForProjectSave(page);
  const svg = await page.evaluate(async (html) => {
    const validationPath = "/src/lib/validate-source.ts";
    const { validateDrawingSource } = await import(validationPath);
    return validateDrawingSource(html, new AbortController().signal);
  }, source);
  // Unmount the workspace and flush its autosaves before changing fixture data.
  await page.goto("/api/health");
  await page.evaluate(
    async ({ html, svg }) => {
      const projectPath = "/src/lib/projects.ts";
      const historyPath = "/src/lib/history.ts";
      const { loadProjects, saveProject } = await import(projectPath);
      const { pushHistory } = await import(historyPath);
      const { projects, activeId } = await loadProjects();
      const project = projects.find(
        (item: { id: string }) => item.id === activeId,
      );
      if (!project) throw new Error("Missing fixture project");
      const drawing = project.history.items[project.history.index];
      project.history = pushHistory(project.history, {
        ...drawing,
        revision: crypto.randomUUID(),
        title: drawing?.title || project.name,
        summary: "Fixture drawing",
        notes: drawing?.notes || [],
        svg,
        html,
      });
      await saveProject(project);
    },
    { html: source, svg },
  );
  await page.goto("/");
  await expect(page.locator(".app-header")).toBeVisible();
}

/** Wait for startup and drain queued project writes before a reload or fixture edit. */
export async function waitForProjectSave(page: Page) {
  await expect(page.locator(".app-header")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open("draftline-projects", 1);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        try {
          return await new Promise<number>((resolve, reject) => {
            // This transaction queues behind autosaves already submitted by React.
            const transaction = db.transaction("projects", "readwrite");
            const request = transaction.objectStore("projects").count();
            transaction.oncomplete = () => resolve(request.result);
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error);
          });
        } finally {
          db.close();
        }
      }),
    )
    .toBeGreaterThan(0);
}

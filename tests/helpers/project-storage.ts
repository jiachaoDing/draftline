import { expect, type Page } from "@playwright/test";

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

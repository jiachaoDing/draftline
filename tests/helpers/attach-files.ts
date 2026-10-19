import type { Page, FileChooser } from "@playwright/test";

export async function attachFiles(
  page: Page,
  files: Parameters<FileChooser["setFiles"]>[0],
) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Attach files" }).click();
  await (await chooser).setFiles(files);
}

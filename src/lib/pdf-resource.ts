import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = workerUrl;

/** PDF.js parses local bytes; only a selected page's pixels/text leave the browser. */
export async function inspectPdf(
  file: string,
  pageNumber: number,
  mode: "metadata" | "preview" | "text",
  signal: AbortSignal,
): Promise<{
  pages: number;
  page: number;
  width: number;
  height: number;
  units: string;
  text?: string;
  image?: string;
}> {
  signal.throwIfAborted();
  const bytes = Uint8Array.from(atob(file.slice(file.indexOf(",") + 1)), (c) =>
    c.charCodeAt(0),
  );
  const task = getDocument({
    data: bytes,
    disableFontFace: true,
    useSystemFonts: true,
    useWorkerFetch: false,
    useWasm: false,
    enableXfa: false,
    maxImageSize: 16_000_000,
    canvasMaxAreaInBytes: 16_000_000,
    stopAtErrors: true,
  });
  let timedOut = false;
  const abort = () => {
    void task.destroy();
  };
  const timeout = setTimeout(() => {
    timedOut = true;
    abort();
  }, 15000);
  signal.addEventListener("abort", abort, { once: true });
  try {
    const pdf = await task.promise;
    if (pageNumber > pdf.numPages)
      throw new Error(
        `PDF contains ${pdf.numPages} pages. Choose an existing one-based page.`,
      );
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const metadata = {
      pages: pdf.numPages,
      page: pageNumber,
      width: viewport.width,
      height: viewport.height,
      units: "pt",
    };
    if (mode === "metadata") return metadata;
    if (mode === "text") {
      const content = await page.getTextContent();
      signal.throwIfAborted();
      return {
        ...metadata,
        text: content.items
          .map((item) =>
            "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "",
          )
          .join(""),
      };
    }
    const canvas = document.createElement("canvas");
    const scaled = page.getViewport({
      scale: Math.min(1, 1024 / viewport.width, 1024 / viewport.height),
    });
    canvas.width = Math.max(1, Math.ceil(scaled.width));
    canvas.height = Math.max(1, Math.ceil(scaled.height));
    await page.render({ canvas, viewport: scaled }).promise;
    signal.throwIfAborted();
    return { ...metadata, image: canvas.toDataURL("image/webp", 0.85) };
  } catch (error) {
    signal.throwIfAborted();
    if (timedOut)
      throw new Error("PDF inspection timed out. Try a simpler document.");
    throw error;
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
    await task.destroy();
  }
}

type DxfInspection = {
  entities: number;
  entityTypes: Record<string, number>;
  svg?: string;
};

export async function inspectDxf(
  text: string,
  preview: boolean,
  signal: AbortSignal,
): Promise<DxfInspection> {
  signal.throwIfAborted();
  const worker = new Worker(new URL("./dxf-worker.ts", import.meta.url), {
    type: "module",
  });
  try {
    return await new Promise<DxfInspection>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timeout);
        signal.removeEventListener("abort", abort);
      };
      const abort = () => {
        cleanup();
        reject(new DOMException("Aborted", "AbortError"));
      };
      const timeout = setTimeout(() => {
        cleanup();
        reject(
          new Error(
            "DXF inspection timed out. Use bounded text access instead.",
          ),
        );
      }, 10000);
      signal.addEventListener("abort", abort, { once: true });
      worker.onmessage = (
        event: MessageEvent<DxfInspection & { ok: boolean; error?: string }>,
      ) => {
        cleanup();
        if (event.data.ok) resolve(event.data);
        else reject(new Error(event.data.error));
      };
      worker.onerror = () => {
        cleanup();
        reject(new Error("DXF preview is unavailable."));
      };
      worker.postMessage({ text, preview });
    });
  } finally {
    worker.terminate();
  }
}

import { buildSandbox } from "./sandbox";
import { cleanDrawing } from "./drawing";

/** Execute a tool candidate in the same opaque-origin sandbox as manual edits. */
export function validateDrawingSource(
  html: string,
  signal: AbortSignal,
): Promise<string> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const channel = crypto.randomUUID();
    const container = document.createElement("div");
    container.className = "validation-preview";
    container.setAttribute("aria-hidden", "true");
    const frame = document.createElement("iframe");
    frame.title = "Agent drawing validation sandbox";
    frame.setAttribute("sandbox", "allow-scripts");
    frame.loading = "eager";
    frame.tabIndex = -1;
    frame.referrerPolicy = "no-referrer";
    let settled = false;
    const finish = (error?: Error, svg?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
      window.removeEventListener("message", receive);
      container.remove();
      if (error) reject(error);
      else resolve(svg!);
    };
    const cancel = () =>
      finish(new DOMException("Generation stopped.", "AbortError"));
    const receive = (event: MessageEvent) => {
      if (
        event.source !== frame.contentWindow ||
        event.data?.channel !== channel
      )
        return;
      const { type, payload } = event.data;
      if (type === "error" && typeof payload === "string")
        finish(new Error(payload.slice(0, 1000)));
      if (
        type === "snapshot" &&
        typeof payload === "string" &&
        payload.length <= 600_000
      ) {
        try {
          finish(undefined, cleanDrawing(payload));
        } catch (error) {
          finish(error as Error);
        }
      }
    };
    const timer = setTimeout(
      () =>
        finish(
          new Error(
            "Drawing validation did not finish. Read the source and correct it.",
          ),
        ),
      6000,
    );
    signal.addEventListener("abort", cancel, { once: true });
    window.addEventListener("message", receive);
    const source = buildSandbox(html, channel, false);
    container.append(frame);
    document.body.append(container);
    frame.getBoundingClientRect();
    frame.srcdoc = source;
  });
}

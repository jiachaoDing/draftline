import { afterEach, describe, expect, it, vi } from "vitest";
import { validateDrawingSource } from "../src/lib/validate-source";
import { buildSandbox } from "../src/lib/sandbox";
import { EXAMPLE_SVG } from "../src/lib/example";

vi.mock("../src/lib/sandbox", () => ({ buildSandbox: vi.fn(() => "") }));

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("validation resource lifetime", () => {
  it("releases timers and listeners when sandbox construction throws", async () => {
    vi.useFakeTimers();
    const remove = vi.spyOn(window, "removeEventListener");
    const controller = new AbortController();
    const removeAbort = vi.spyOn(controller.signal, "removeEventListener");
    vi.mocked(buildSandbox).mockImplementationOnce(() => {
      throw new Error("Invalid source");
    });
    await expect(validateDrawingSource("", controller.signal)).rejects.toThrow(
      "Invalid source",
    );
    expect(vi.getTimerCount()).toBe(0);
    expect(remove).toHaveBeenCalledWith("message", expect.any(Function));
    expect(removeAbort).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(document.querySelector(".validation-preview")).toBeNull();
  });

  it("removes frames after repeated successful validations and cancellation", async () => {
    vi.useFakeTimers();
    for (let index = 0; index < 100; index++) {
      const controller = new AbortController();
      const result = validateDrawingSource("", controller.signal);
      const frame = document.querySelector("iframe")!;
      const channel = vi.mocked(buildSandbox).mock.calls.at(-1)![1];
      window.dispatchEvent(
        new MessageEvent("message", {
          source: frame.contentWindow,
          data: { channel, type: "snapshot", payload: EXAMPLE_SVG },
        }),
      );
      await expect(result).resolves.toContain('id="drawing"');
      expect(document.querySelector("iframe")).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
    }
    const controller = new AbortController();
    const result = validateDrawingSource("", controller.signal);
    controller.abort();
    await expect(result).rejects.toHaveProperty("name", "AbortError");
    expect(document.querySelector("iframe")).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});

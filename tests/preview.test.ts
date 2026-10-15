import { act, createElement, Fragment, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { Preview } from "../src/components/Preview";
import { EXAMPLE, EXAMPLE_SVG } from "../src/lib/example";

describe("preview startup bridge", () => {
  it("receives an early frame snapshot before passive effects and checks both source and channel", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onSnapshot = vi.fn();
    const onError = vi.fn();
    function FrameStartup() {
      useLayoutEffect(() => {
        const frame = container.querySelector("iframe")!;
        const channel = JSON.parse(
          frame.srcdoc.match(/const channel = ("[^"]+");/)![1],
        );
        const dispatch = (source: Window | null, frameChannel: string) =>
          window.dispatchEvent(
            new MessageEvent("message", {
              source,
              data: {
                channel: frameChannel,
                type: "snapshot",
                payload: EXAMPLE_SVG,
              },
            }),
          );
        dispatch(window, channel);
        dispatch(frame.contentWindow, "wrong-channel");
        expect(onSnapshot).not.toHaveBeenCalled();
        dispatch(frame.contentWindow, channel);
      }, []);
      return null;
    }
    try {
      await act(async () =>
        root.render(
          createElement(
            Fragment,
            null,
            createElement(Preview, {
              html: EXAMPLE.html,
              onSnapshot,
              onError,
              onSelection: () => {},
              onZoom: () => {},
              selectedId: null,
              layers: { geometry: true, dimensions: true, presentation: true },
              mode: "select",
            }),
            createElement(FrameStartup),
          ),
        ),
      );
      expect(onSnapshot).toHaveBeenCalledTimes(1);
      expect(onSnapshot.mock.calls[0][0].svg).toContain('id="hole-top-left"');
      expect(onError).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  });
});

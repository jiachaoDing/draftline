import type SelectionArea from "@viselect/vanilla";
import { afterEach, expect, it, vi } from "vitest";
import { installSVGSelection } from "../src/lib/sandbox-selection";
import { OBJECT_SVG } from "./helpers/object-drawing";

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

it("coalesces zoom refreshes and keeps ancestor selection normalized", () => {
  const callbacks = new Map<number, FrameRequestCallback>();
  let sequence = 0;
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((callback) => {
      callbacks.set(++sequence, callback);
      return sequence;
    }),
  );
  vi.stubGlobal(
    "cancelAnimationFrame",
    vi.fn((id) => callbacks.delete(id)),
  );
  class Selection {
    on() {}
  }
  document.body.innerHTML = OBJECT_SVG;
  const svg = document.querySelector("svg")!;
  const editor = installSVGSelection(
    svg,
    Selection as unknown as typeof SelectionArea,
    vi.fn(),
  );
  for (let index = 0; index < 100; index++) editor.refresh();
  expect(callbacks.size).toBe(1);
  editor.setSelection({
    ids: ["logo-left", "logo", "logo", "missing"],
    rootId: null,
  });
  expect(callbacks.size).toBe(0);
  expect(
    [...svg.querySelectorAll("[data-selected]")].map((node) => node.id),
  ).toEqual(["logo"]);
  editor.setSelection({ ids: ["nearby"], rootId: null });
  expect(svg.querySelector("#logo")!.hasAttribute("data-selected")).toBe(false);
  expect(svg.querySelector("#nearby")!.getAttribute("data-selected")).toBe(
    "true",
  );
});

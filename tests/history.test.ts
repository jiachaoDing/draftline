import { describe, expect, it } from "vitest";
import { pushHistory } from "../src/lib/history";

describe("drawing revision history", () => {
  it("drops the redo branch after an edit without mutating earlier history", () => {
    const history = { items: [null, "first", "second"], index: 1 };
    expect(pushHistory(history, "replacement")).toEqual({
      items: [null, "first", "replacement"],
      index: 2,
    });
    expect(history).toEqual({ items: [null, "first", "second"], index: 1 });
  });
  it("retains at most 30 revisions and points at the latest drawing", () => {
    let history = { items: [0], index: 0 };
    for (let i = 1; i <= 40; i++) history = pushHistory(history, i);
    expect(history.items).toHaveLength(30);
    expect(history.items[0]).toBe(11);
    expect(history.items[history.index]).toBe(40);
  });
});

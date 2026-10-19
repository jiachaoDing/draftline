import { afterEach, describe, expect, it } from "vitest";
import {
  currentLocale,
  LANGUAGE_STORAGE_KEY,
  resolveLocale,
  setLocale,
  t,
} from "../src/lib/i18n";

afterEach(() => {
  setLocale("en");
  localStorage.removeItem(LANGUAGE_STORAGE_KEY);
});

describe("workspace languages", () => {
  it("defaults to Simplified Chinese and preserves an explicit saved language", () => {
    expect(resolveLocale("en")).toBe("en");
    expect(resolveLocale("zh-CN")).toBe("zh-CN");
    expect(resolveLocale(null)).toBe("zh-CN");
    expect(resolveLocale("invalid")).toBe("zh-CN");
  });

  it("switches document language, stores preference and interpolates whole messages", () => {
    setLocale("zh-CN");
    expect(currentLocale()).toBe("zh-CN");
    expect(document.documentElement.lang).toBe("zh-CN");
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("zh-CN");
    expect(t("Model settings")).toBe("模型设置");
    expect(t("Open drawing {{name}}", { name: "支架 <A>" })).toBe(
      "打开图纸 支架 <A>",
    );
    expect(t("Unrecognized provider diagnostic.")).toBe(
      "Unrecognized provider diagnostic.",
    );
    setLocale("en");
    expect(t("Open drawing {{name}}", { name: "Bracket" })).toBe(
      "Open drawing Bracket",
    );
  });

  it("keeps switching usable when preference storage fails", () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error("Storage blocked");
    };
    try {
      expect(() => setLocale("zh-CN")).not.toThrow();
      expect(t("Drawing assistant")).toBe("绘图助手");
    } finally {
      Storage.prototype.setItem = original;
    }
  });
});

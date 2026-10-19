import { describe, expect, it } from "vitest";
import { parseAttachment } from "../src/lib/attachments";
import { attachmentsSchema } from "../src/lib/contracts";
import { runtimeAttachment, savedAttachment } from "../src/lib/chat-runtime";

describe("assistant-ui attachment adapters", () => {
  it("reads SVG and DXF as text and round-trips native PDF/image parts", async () => {
    for (const [name, mime, content, type] of [
      ["drawing.svg", "image/svg+xml", "<svg/>", "svg"],
      ["part.dxf", "application/dxf", "ENTITIES", "dxf"],
      ["notes.txt", "text/plain", "40 × 30 mm", "text"],
      ["sheet.pdf", "application/pdf", "%PDF-1.4", "pdf"],
      ["sketch.png", "image/png", "png", "image"],
    ]) {
      const attachment = await parseAttachment(
        new File([content], name, { type: mime }),
      );
      expect(attachment.type).toBe(type);
      if (type === "pdf")
        expect(attachment.file).toMatch(/^data:application\/pdf;base64,/);
      if (type === "text" || type === "svg" || type === "dxf")
        expect(attachment.text).toContain(content);
      expect(savedAttachment(runtimeAttachment(attachment))).toEqual(
        attachment,
      );
    }
  });
  it("bounds file count and aggregate size and refuses unsafe media URLs", async () => {
    const item = {
      id: "one",
      type: "text",
      name: "notes.txt",
      size: 1,
      text: "size",
    };
    expect(
      attachmentsSchema.safeParse(Array.from({ length: 11 }, () => item))
        .success,
    ).toBe(false);
    expect(
      attachmentsSchema.safeParse([
        { ...item, size: 5 * 1024 * 1024 },
        { ...item, size: 5 * 1024 * 1024 },
      ]).success,
    ).toBe(false);
    expect(
      attachmentsSchema.safeParse([
        { ...item, image: "https://tracking.example/image" },
      ]).success,
    ).toBe(false);
    await expect(
      parseAttachment(new File([new Uint8Array(9 * 1024 * 1024)], "large.txt")),
    ).rejects.toThrow("8 MB");
    await expect(
      parseAttachment(
        new File(["binary"], "app.exe", { type: "application/octet-stream" }),
      ),
    ).rejects.toThrow();
  });
});

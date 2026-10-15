// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { applyCodexPatch } from "../src/lib/codex-patch";
import { codexPatchWasm } from "../src/lib/codex-patch-wasm";

describe("original Codex Rust WASM engine", () => {
  it("ships the recorded upstream-derived sources and the verified runtime WASM artifact", () => {
    const manifest = JSON.parse(
      readFileSync("third_party/codex/apply-patch/build.json", "utf8"),
    );
    const hash = (bytes: Uint8Array) =>
      createHash("sha256").update(bytes).digest("hex");
    expect(hash(Buffer.from(codexPatchWasm, "base64"))).toBe(
      manifest.wasmSha256,
    );
    for (const [file, digest] of Object.entries(manifest.sources))
      expect(hash(readFileSync(file)), file).toBe(digest);
    for (const name of ["seek_sequence", "text_file"])
      expect(
        readFileSync(`third_party/codex/apply-patch/src/${name}.rs`, "utf8"),
      ).toBe(
        readFileSync(
          `third_party/codex/apply-patch/upstream/${name}.rs`,
          "utf8",
        ),
      );
    const update = readFileSync(
      "third_party/codex/apply-patch/upstream/file_update.rs",
      "utf8",
    );
    const original = update
      .slice(
        update.indexOf("/// Compute a list"),
        update.indexOf("/// Intended result"),
      )
      .replace(
        "fn compute_replacements(",
        "pub(crate) fn compute_replacements(",
      );
    expect(
      readFileSync("third_party/codex/apply-patch/src/file_update.rs", "utf8"),
    ).toContain(original);
    const module = new WebAssembly.Module(
      Buffer.from(codexPatchWasm, "base64"),
    );
    expect(WebAssembly.Module.imports(module)).toEqual([]);
  });
  const root = "third_party/codex/apply-patch/fixtures";
  for (const scenario of readdirSync(root)) {
    it(`preserves upstream fixture ${scenario}`, async () => {
      const directory = `${root}/${scenario}`;
      const inputName = readdirSync(`${directory}/input`)[0];
      const source = readFileSync(`${directory}/input/${inputName}`, "utf8");
      const patch = readFileSync(`${directory}/patch.txt`, "utf8").replace(
        /(\*\*\* Update File: )[^\r\n]+/,
        "$1drawing.html",
      );
      if (["006", "008", "013"].includes(scenario.slice(0, 3))) {
        await expect(applyCodexPatch(source, patch)).rejects.toThrow(
          scenario.startsWith("006")
            ? "Failed to find expected lines"
            : "invalid",
        );
      } else {
        const expected = readFileSync(
          `${directory}/expected/${inputName}`,
          "utf8",
        );
        expect(await applyCodexPatch(source, patch)).toBe(expected);
      }
    });
  }
  it("rejects ambiguous contexts while retaining upstream whitespace matching", async () => {
    const patch =
      "*** Begin Patch\n*** Update File: drawing.html\n@@\n-old\n+new\n*** End Patch";
    await expect(applyCodexPatch("old\nold\n", patch)).rejects.toThrow(
      "Ambiguous",
    );
    expect(await applyCodexPatch("  old  \n", patch)).toBe("new\n");
  });
  it("restricts operations and paths to one virtual update", async () => {
    for (const body of [
      "*** Add File: drawing.html\n+abc",
      "*** Delete File: drawing.html",
      "*** Update File: ../secrets\n@@\n-a\n+b",
      "*** Update File: drawing.html\n*** Move to: x\n@@\n-a\n+b",
      "*** Update File: drawing.html\n@@\n-a\n+b\n*** Update File: drawing.html\n@@\n-a\n+b",
    ])
      await expect(
        applyCodexPatch("a\n", `*** Begin Patch\n${body}\n*** End Patch`),
      ).rejects.toThrow(/Only/);
  });
  it("retains upstream Unicode normalization and missing-context errors", async () => {
    const patch = (line: string) =>
      `*** Begin Patch\n*** Update File: drawing.html\n@@\n-${line}\n+updated ✅\n*** End Patch`;
    expect(
      await applyCodexPatch("‘quote’ — dash\n", patch("'quote' - dash")),
    ).toBe("updated ✅\n");
    await expect(
      applyCodexPatch("unrelated\n", patch("missing")),
    ).rejects.toThrow(
      "Failed to find expected lines in drawing.html:\nmissing",
    );
  });
});

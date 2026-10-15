// Reproducible, mechanical adaptation of the pinned upstream Rust modules.
import { readFile, writeFile } from "node:fs/promises";
const root = "third_party/codex/apply-patch";
for (const name of [
  "parser",
  "streaming_parser",
  "seek_sequence",
  "text_file",
]) {
  let source = await readFile(`${root}/upstream/${name}.rs`, "utf8");
  source = source.replace(/\r\n/g, "\n");
  source = source.replace("    use pretty_assertions::assert_eq;\n", "");
  if (name === "parser") {
    source = source
      .replace(
        "#[cfg(test)]\nuse codex_utils_absolute_path::test_support::PathBufExt;\n",
        "",
      )
      .replace(/use codex_utils_path_uri::[^;]+;\n/g, "")
      .replace("use thiserror::Error;\n", "")
      .replace("PartialEq, Error, Clone", "PartialEq, Clone")
      .replace(/    #\[error\([^\n]+\)\]\n/g, "")
      .replace(/    pub fn resolve_path\([\s\S]*?\n    }\n/, "");
    source = source
      .replace(
        /#\[test\]\nfn test_hunk_resolve_path_accepts_relative_and_absolute_paths\(\) \{[\s\S]*?\n}\n/,
        "",
      )
      .replace(
        "let dir = tempfile::tempdir().unwrap();",
        'let dir = PathBuf::from("/tmp/codex-parser-test");',
      )
      .replace(/dir\.path\(\)\.join\(([^)]+)\)\.abs\(\)/g, "dir.join($1)");
  }
  await writeFile(`${root}/src/${name}.rs`, source, "utf8");
}
const update = (
  await readFile(`${root}/upstream/file_update.rs`, "utf8")
).replace(/\r\n/g, "\n");
await writeFile(
  `${root}/src/file_update.rs`,
  "use crate::{ApplyPatchError, UpdateFileChunk, seek_sequence};\nuse crate::text_file::Replacement;\n\n" +
    update
      .slice(
        update.indexOf("/// Compute a list"),
        update.indexOf("/// Intended result"),
      )
      .replace(
        "fn compute_replacements(",
        "pub(crate) fn compute_replacements(",
      ),
  "utf8",
);

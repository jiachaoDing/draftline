// Run against a checkout of the recorded upstream commit, never a floating ref.
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
const commit = "c22a06c18070c3e33bd2648c7210a00a2a9f6f80";
const checkout = process.argv[2];
if (!checkout) throw new Error("Provide the pinned Codex checkout path.");
const git = (args) => {
  const result = spawnSync("git", ["-C", checkout, ...args]);
  if (result.status !== 0) throw new Error(result.stderr.toString());
  return result.stdout;
};
if (git(["rev-parse", "HEAD"]).toString().trim() !== commit)
  throw new Error("Upstream checkout must be at the recorded commit.");
const scenarios = [
  "003",
  "006",
  "008",
  "013",
  "014",
  "016",
  "017",
  "019",
  "021",
  "022",
  "023",
  "024",
];
const prefix = "codex-rs/apply-patch/";
const files = git(["ls-tree", "-r", "--name-only", commit, prefix])
  .toString()
  .trim()
  .split("\n");
for (const file of files) {
  let destination;
  if (
    /src\/(parser|streaming_parser|seek_sequence|text_file|file_update|file_update_tests)\.rs$/.test(
      file,
    )
  )
    destination = `third_party/codex/apply-patch/upstream/${path.basename(file)}`;
  const relative = file.slice(`${prefix}tests/fixtures/scenarios/`.length);
  if (
    file.startsWith(`${prefix}tests/fixtures/scenarios/`) &&
    scenarios.includes(relative.slice(0, 3))
  )
    destination = `third_party/codex/apply-patch/fixtures/${relative}`;
  if (!destination) continue;
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, git(["show", `${commit}:${file}`]));
}

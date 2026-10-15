import { spawnSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { WASI } from "node:wasi";
import "./prepare-codex-patch.mjs";
const root = "third_party/codex/apply-patch";
const result = spawnSync(
  process.env.CARGO || "cargo",
  [
    "test",
    "--locked",
    "--manifest-path",
    `${root}/Cargo.toml`,
    "--target",
    "wasm32-wasip1",
    "--lib",
    "--no-run",
  ],
  { stdio: "inherit" },
);
if (result.status !== 0) process.exit(result.status || 1);
const directory = `${root}/target/wasm32-wasip1/debug/deps`;
const name = (await readdir(directory)).find((name) =>
  /^draftline_codex_patch-.*\.wasm$/.test(name),
);
if (!name) throw new Error("Rust test executable was not built.");
const wasi = new WASI({
  version: "preview1",
  args: [name, "--test-threads=1"],
  env: {},
  preopens: {},
  returnOnExit: true,
});
const module = await WebAssembly.compile(
  await readFile(`${directory}/${name}`),
);
const instance = await WebAssembly.instantiate(module, wasi.getImportObject());
process.exitCode = wasi.start(instance);

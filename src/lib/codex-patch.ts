// The parser/matcher/updater execute in the vendored Rust WASM, never in JS.
type PatchEngine = {
  memory: WebAssembly.Memory;
  alloc: (length: number) => number;
  dealloc: (pointer: number, length: number) => void;
  apply: (
    source: number,
    sourceLength: number,
    patch: number,
    patchLength: number,
  ) => bigint;
};
let engine: Promise<PatchEngine> | undefined;
async function loadEngine() {
  const { codexPatchWasm } = await import("./codex-patch-wasm");
  const bytes = Uint8Array.from(atob(codexPatchWasm), (c) => c.charCodeAt(0));
  const { instance } = await WebAssembly.instantiate(bytes, {});
  return instance.exports as unknown as PatchEngine;
}
export async function applyCodexPatch(source: string, patch: string) {
  if (source.length > 600_000 || patch.length > 200_000)
    throw new Error("The drawing or patch is too large.");
  const runtime = await (engine ??= loadEngine());
  const encoder = new TextEncoder();
  const sourceBytes = encoder.encode(source);
  const patchBytes = encoder.encode(patch);
  const sourcePointer = runtime.alloc(sourceBytes.length);
  const patchPointer = runtime.alloc(patchBytes.length);
  let outputPointer = 0;
  let outputLength = 0;
  try {
    new Uint8Array(
      runtime.memory.buffer,
      sourcePointer,
      sourceBytes.length,
    ).set(sourceBytes);
    new Uint8Array(runtime.memory.buffer, patchPointer, patchBytes.length).set(
      patchBytes,
    );
    const result = runtime.apply(
      sourcePointer,
      sourceBytes.length,
      patchPointer,
      patchBytes.length,
    );
    outputPointer = Number(result & 0xffffffffn);
    outputLength = Number(result >> 32n);
    const output = new TextDecoder().decode(
      new Uint8Array(runtime.memory.buffer, outputPointer, outputLength),
    );
    if (output[0] !== "0") throw new Error(output.slice(1));
    return output.slice(1);
  } finally {
    runtime.dealloc(sourcePointer, sourceBytes.length);
    runtime.dealloc(patchPointer, patchBytes.length);
    if (outputLength) runtime.dealloc(outputPointer, outputLength);
  }
}

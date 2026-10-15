# Codex patch engine in Draftline

Upstream: [openai/codex](https://github.com/openai/codex), commit
[`c22a06c18070c3e33bd2648c7210a00a2a9f6f80`](https://github.com/openai/codex/tree/c22a06c18070c3e33bd2648c7210a00a2a9f6f80).
Copyright 2025 OpenAI. Apache-2.0; [LICENSE](../LICENSE) and [NOTICE](../NOTICE).
Draftline modifications are described below.

## Runtime source reuse

`upstream/` contains byte-for-byte Git blobs of `codex-rs/apply-patch/src/`
`parser.rs`, `streaming_parser.rs`, `seek_sequence.rs`, `text_file.rs`,
`file_update.rs` and `file_update_tests.rs`. `fixtures/` contains twelve original
single-file update/error scenarios, including Unicode, EOF, CRLF and mixed
line endings. Git preserves fixture bytes (`-text`).

`scripts/prepare-codex-patch.mjs` mechanically generates `src/`:

- `seek_sequence.rs` and `text_file.rs` are unchanged. Exact, trailing-whitespace,
  trimmed-whitespace and Unicode normalization matching, context preservation
  and line-ending behavior execute as upstream Rust.
- `streaming_parser.rs` retains the parser implementation and its tests; the
  assertion import uses Rust's built-in `assert_eq!` instead of pretty_assertions.
- `parser.rs` retains grammar, lenient heredoc parsing, hunks, context indices,
  environment-ID parsing and error messages. The filesystem URI resolver is
  excluded. thiserror attributes are replaced by equivalent Display formatting
  in the wrapper, avoiding host proc-macro/linker dependencies. The absolute-path
  parser test uses fixed paths instead of a temp directory. The filesystem URI
  resolver test remains in `upstream/parser.rs`.
- `file_update.rs` is the original `compute_replacements` function extracted
  unchanged, with its visibility and imports adapted. SourceFile parsing,
  replacement calculation and application run in the original Rust modules.

`src/lib.rs` supplies the in-memory wrapper and a small UTF-8 allocation/result
ABI. It parses first, restricts the operation to one `Update File: drawing.html`
hunk, and passes the original chunks into the original update algorithm.
Draftline's additional policy rejects ambiguous matches and overlapping
replacements. The ambiguity preflight calls the original matcher again; it
conservatively rejects subsequent tolerant matches as well as exact duplicates.
Add/delete/move, environment IDs and other paths are rejected at this boundary.
The WASM has no imports and no filesystem access.

`src/lib/codex-patch.ts` loads the checked-in WASM payload lazily and handles
allocation/freeing only. **The Rust parser, matcher and updater are used at
runtime in both development and production.** `build.json` records the upstream
commit, source SHA-256 hashes, compiler and WASM digest. Vitest checks these
hashes and executes original fixture expectations through that same payload.
The artifact is base64 in JS so Draftline's text-asset Worker packager can serve
it without a separate native service or binary-asset route.

## Source inspection and tool execution

Reviewed upstream sources at this commit:

- `core/src/tools/handlers/apply_patch{,_spec}.rs`: tool grammar, complete-call
  handling, verified actions, parser feedback and execution routing.
- `core/src/tools/handlers/shell_spec.rs` and `handlers/unified_exec/`: shell-based
  source inspection and execution feedback.
- `core/src/tools/{router,registry}.rs`: advertised tool specs, dispatch, typed
  output, call IDs and model-facing errors.
- `core/src/stream_events_utils.rs`: record the completed call, queue execution,
  return a tool output on RespondToModel, and set `needs_follow_up`.
- `core/src/session/turn.rs`: sample with accumulated history, continue after
  tool work, and finish when no follow-up is required.

Draftline ports the small call/result/follow-up control flow to
`src/lib/drawing-agent.ts`. The full Codex session/runtime depends on its terminal,
process, sandbox, history, routing, telemetry and provider infrastructure; the
browser loop uses Draftline's existing streamed Chat Completions integration.
Each source-tool completion is dispatched serially, exact calls and outputs are
appended to provider history, and errors are returned to the model for inspection
and retry. There are 16 execution rounds, four calls per round and a 3 MB history
budget. Transport errors and cancellation roll back the request.

`server/drawing-tools.ts` advertises portable function tools `read_source`,
`search_source` and `apply_patch`. The latter wraps Codex's patch text in
`{revision, patch}` for the shared OpenAI-compatible function interface and
explicit optimistic concurrency. `source-inspection.ts` uses parse5's source
locations to return numbered source windows, selected-element context and
associated dimensions; literal search is bounded. Only the current versioned
virtual file participates.

`DrawingToolSession` separately owns policy and execution. Each patch is staged,
sandboxed and validated before replacing its private working version. Selected
edits use the existing ID/type/descendant and associated-dimension policy.
Success returns a fresh revision and canonical source metadata; failures return
the unchanged revision and the original parser/update error or a validation
error. A terminal successful message commits the request as one history entry.
Questions are submitted before mutations and retain inspection/error history
and exact tool IDs through IndexedDB and refresh. Source history, manual commits,
undo/redo, rendering and exports share the canonical SVG and revision identity.

## Rebuild and verify

Normal `npm ci`, `npm run dev`, `npm run build` and `npm run verify:all` use the
checked-in artifact. To modify Rust, install Rust with targets
`wasm32-unknown-unknown` and `wasm32-wasip1`, then run:

```powershell
npm run build:patch
npm run test:patch
npm test -- tests/codex-patch.test.ts tests/drawing-agent.test.ts
npm run verify:all
```

`CARGO` can point to cargo.exe when Cargo is outside PATH. `test:patch` compiles
the retained Rust tests to WASI and runs them in Node's WASI runtime with no
directory preopens. `build:patch` generates the payload and provenance manifest.
Node reports its experimental WASI warning for the upstream-test runner.

To recreate the original source copies, check out the exact commit in a separate
Codex checkout and run `node scripts/vendor-codex-patch.mjs <checkout>`. That
script reads Git blobs, preserving original line endings, and verifies HEAD.
The original filesystem scenarios and source are available at the linked commit.

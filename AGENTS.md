# Working on Draftline

Draftline turns sketches and measured instructions into editable millimeter SVG drawings. Preserve streaming replies, synchronous generated HTML/JavaScript, targeted edits, project conversations, undo/redo, and both SVG export modes. Ask for essential missing measurements; never invent manufacturing requirements.

## Start here

- Read [README.md](README.md) for product behavior and setup, [docs/architecture.md](docs/architecture.md) for boundaries and contracts, and [docs/development.md](docs/development.md) for checks and debugging.
- Inspect the relevant implementation and behavior tests before editing. Check `git status`; preserve unrelated user changes.
- Read and write all files as UTF-8. In this Windows environment use PowerShell `Get-ChildItem` and `Select-String` for file/text searches; `rg` is unavailable. Use `Get-Content -Encoding UTF8`.
- Apply small patches. Prefer the smallest independently verifiable improvement; record risky architectural proposals in the architecture document instead of speculative rewrites.

## Module boundaries

- `src/App.tsx` coordinates the active workspace, request lifecycle and drawing commits. `src/components/` owns focused UI; `src/hooks/` owns React side effects with one responsibility.
- `src/lib/contracts.ts` and `user-input.ts` provide universal Zod contracts; keep their runtime dependencies usable in both browser and server.
- `ai-workflow.ts` and `user-input-flow.ts` build credential-free request context and drawing/question transitions. They do not fetch or save.
- `drawing.ts` owns sanitization, SVG validation, patch boundaries and exports; `presentation.ts` derives sheet information. `sandbox.ts` and `components/Preview.tsx` own execution and the frame bridge.
- `projects.ts` owns project validation and IndexedDB; `model-settings.ts` owns credential settings restoration. Credentials belong only in settings and provider requests.
- `src/lib/api.ts` and `stream.ts` are browser transport. `server/` owns provider SDK access, messages, SSE, redaction and API policy. Biome forbids server/Node/provider imports from `src/`.

## Non-negotiable invariants

- Partial streamed JSON is display-only. A successful terminal response is mandatory; full HTML also requires a sanitized, validated sandbox snapshot before committing. Cancellation and failures preserve the committed drawing.
- Each frame uses `sandbox="allow-scripts"`, an opaque origin, CSP, and source/channel-checked messages. Keep credentials out of frame messages, prompts, projects, URLs, exports and logs.
- One SVG unit equals one millimeter. Keep stable object/group IDs and `geometry`/`dimensions` groups. Selection supplies intent context; AI chooses a coherent edit scope. Changes beyond selected objects and associated dimensions require review before commit. Presentation, viewport transforms and selection overlays are derived from the canonical SVG.
- Keep pending question context and tool IDs through retries, refreshes and project switches. Highlighted options require explicit submission. Preserve schema defaults for saved records.
- Project navigation remains blocked during active generation/validation. Every drawing commit goes through bounded revision history; new edits drop the redo branch.

## Implementation and completion

- Use strict TypeScript, named data contracts, direct imports, and focused pure functions. Colocate transient UI state with its consumer. Avoid barrel exports, global stores or new infrastructure without a demonstrated need.
- Reuse installed open-source libraries before adding a dependency. Check peer compatibility; keep `package-lock.json` in sync. Format with Prettier (two spaces, LF).
- Add behavior tests for changed invariants or regressions, not implementation snapshots. Vitest covers contracts and pure logic; Playwright covers the real browser/server/provider boundary using local fixtures.
- Run targeted checks while iterating; before completion run `npm run verify:all`. See development docs for browser installation. Report exact checks and any limitations.
- Update current documentation alongside behavior/interface changes. Delete descriptions of removed capabilities, dependencies, files, configuration and routes. Keep historical explanations in Git/PR/change records.
- Summarize what changed, why, verification and material remaining risks. Do not publish or deploy unless requested.

# Development and verification

Use Node.js 24.11+ and npm. Files are UTF-8. Install the lockfile with `npm ci`, then run `npm run dev`. Vite serves `http://127.0.0.1:3000`, proxying `/api` to the Hono Node server on port 3001. Both processes start from `scripts/dev.mjs`.

## Commands

Conversation regressions are covered by `conversation.test.ts`, `model-stream.test.ts`, `provider.test.ts` and `e2e/conversation.spec.ts`: edits, regeneration, descendant branches, blank-canvas restoration, retry deduplication, persisted tool execution, review refresh and one-step undo. Run the existing question, incremental, resource and workspace suites when changing request ownership. `npx wrangler deploy --dry-run` validates Worker packaging without publishing.

The `browser-restart` Playwright project runs the persistent-profile restart regression in an independent worker. The `workspace` project covers browser contexts, provider streams and editor interactions. Both run through `npm run verify:all`; use `--project=browser-restart` to inspect full-browser persistence on its own.

| Command                | Purpose                                                                                                        |
| ---------------------- | -------------------------------------------------------------------------------------------------------------- |
| `npm run lint`         | Biome correctness, React hook and browser/server import boundaries; warnings fail                              |
| `npm run format:check` | Check Prettier formatting                                                                                      |
| `npm run format`       | Format maintained source/config/docs; excludes generated output and third-party files                          |
| `npm run check`        | Strict TypeScript checking for source, server, tests and tooling                                               |
| `npm test`             | Vitest unit/integration suite                                                                                  |
| `npm run test:e2e`     | Full browser suite with the local compatible provider; starts the dev server                                   |
| `npm run build`        | Type check, Vite client and bundled Worker/Node server with license assets                                     |
| `npm run build:patch`  | Rebuild original Codex Rust WASM and recorded source/artifact hashes; requires Rust and wasm32-unknown-unknown |
| `npm run test:patch`   | Run retained upstream Rust parser/matcher tests using wasm32-wasip1 and Node WASI                              |
| `npm start`            | Serve the build on loopback port 3000; `PORT` overrides it                                                     |
| `npm run verify`       | Lint, formatting, types, unit/integration tests and production build                                           |
| `npm run verify:all`   | All of `verify`, then browser regression tests; completion/CI gate                                             |

Playwright uses installed Microsoft Edge by default. To use its Chromium on Windows:

```powershell
npx playwright install chromium
$env:PLAYWRIGHT_CHANNEL = "chromium"
npm run verify:all
```

CI installs Chromium with OS dependencies and sets the same environment variable. The checked-in workflow runs on pushes and pull requests. Tests use deterministic local HTTP providers through the actual OpenAI SDK and Hono server, with test-only credentials. No live API credentials are needed.

`DRAFTLINE_DEV_PORT` and `DRAFTLINE_API_PORT` override the frontend and API ports for both development and Playwright (defaults 3000/3001). Use a free pair to test current server code alongside an existing development session. The Node development API loads server modules at startup; restart it after server contract changes. Playwright's persistent-profile checks use the configured base URL. `PLAYWRIGHT_WORKERS` controls browser concurrency (default 2); use 1 for a serial run on a busy machine.

Playwright waits for the proxied `/api/health` endpoint so both Vite and the API are ready before browser workflows begin. Browser workflows run with two workers and a 60-second overall budget to allow cold Vite/browser startup. The persistent-profile restart case allows 120 seconds for two Edge startup/shutdown cycles and a large reference. Individual assertions retain their own timeouts; the drawing sandbox fails after six seconds. Drawing commit assertions wait for the validation lifecycle to end before inspecting the visible SVG.

## Cloudflare deployment checks

Run `npm run build`, `npx wrangler types --include-runtime false` and `npx wrangler deploy --dry-run` to validate the Cloudflare configuration and bundle. `npm run dev:worker` serves the production API and Static Assets locally. Check `/api/health`, `/`, a fingerprinted JS asset, CSP, cache headers and the drawing sandbox. `npm run deploy` builds and publishes the Worker and custom domain configured in `wrangler.jsonc`.

Cloudflare authentication is stored by Wrangler outside the repository. Use `npx wrangler whoami` to check it and `npx wrangler login` to refresh it. The Git-connected Workers settings use `npm run build` and `npx wrangler deploy` as separate build/deploy commands. Build output, Wrangler state and local secrets are ignored by Git.

## Small-change workflow

1. Read the relevant module and existing behavior tests; reproduce the issue or define the invariant to preserve.
2. Add a focused regression for changed behavior. Extract pure domain logic where it removes coupling; keep React event/cancellation and commit ownership explicit.
3. Make small UTF-8 patches and run targeted tests/types. Inspect the diff for unrelated changes and update the matching documentation.
4. Run `npm run verify:all`. Report failed or unavailable checks explicitly, with their reason; never equate a build with browser verification.

Targeted commands:

```powershell
npm test -- tests/ai-workflow.test.ts tests/user-input-flow.test.ts
npm run test:e2e -- tests/e2e/studio.spec.ts -g "targeted edit"
npm run test:e2e -- tests/e2e/user-input.spec.ts
```

For PowerShell searches, use explicit maintained directories to avoid dependencies/build output:

```powershell
Get-ChildItem src,server,tests -Recurse -File | Select-String -Encoding UTF8 -Pattern "applyPatches"
Get-Content -LiteralPath src/lib/drawing.ts -Encoding UTF8
```

## Test map and debugging

- Reasoning settings: `model-reasoning.test.ts` checks automatic defaults, explicit overrides, unknown model IDs and old/invalid saved settings. `provider.test.ts` checks the actual SDK payload for test and drawing routes, parameter omission and rejected enum values. `e2e/model-reasoning.spec.ts` exercises the real browser/server/provider boundary, legacy defaults, persisted choices, model ID preservation and mobile saving.

- Drawing/presentation/export changes: `drawing.test.ts`, `ai-workflow.test.ts`, `history.test.ts`, plus the drawing/code/export/undo cases in `e2e/studio.spec.ts`. `preview.test.ts` delivers a frame snapshot before passive effects to verify early bridge registration and source/channel rejection.
- Object selection and AI scope: `svg-selection.test.ts` checks nested text/groups, stable IDs, group/ungroup appearance and dimension references, normalized selections, hierarchy context and actual change detection independent of source formatting. `e2e/selection.spec.ts` exercises group and leaf picking, Shift-click, nested entry, marquee after zoom, grouping undo/redo, overlay-free exports, and a real streamed source-tool edit of an entire logo from a selected path, with discard/apply, storage and history checks. Review proposals must never enter committed revisions before Apply.
- Incremental source editing: `codex-patch.test.ts` runs the shipped Rust WASM against original upstream fixtures and verifies provenance hashes; `drawing-agent.test.ts` covers version/scope/atomicity, feedback/retry and cancellation. `e2e/incremental.spec.ts` exercises repeated streamed tools through the real provider SDK, browser WASM and isolated validation frame, including failure recovery, consecutive patches, question refresh, manual edits, history, persistence and exports. Rust source updates also require `build:patch` and `test:patch`; see [patch engine attribution](../third_party/codex/apply-patch/README.md).

- Model-round recovery: `drawing-recovery.test.ts` covers bounded JSON/connection retries, exact source/call/result retention, explicit completion validation, duplicate-call rejection, manual continuation failures, base/project conflicts and cancellation. `provider.test.ts` classifies ordinary text, escape errors, incomplete/malformed JSON and invalid schema using metadata-only diagnostics. `e2e/incremental.spec.ts` drives malformed final replies through the real SDK/SSE/sandbox, automatic/manual continuation, project navigation, version conflict, cancellation and one-step undo. Use separate `DRAFTLINE_DEV_PORT`/`DRAFTLINE_API_PORT` values while an existing dev session runs. Check the failed model activity details for allowlisted category, character count, numeric position, finish type and round/attempt; do not collect full responses, attachments, drawing bodies or provider credentials as diagnostics.
- AI transport/messages/security changes: `stream.test.ts`, `provider.test.ts`, `messages.test.ts`, `user-input-provider.test.ts`. Keep terminal result, cancellation, malformed/truncated stream and safe error behavior covered.
- Project resources: `resources.test.ts` covers large UTF-8 preservation, persisted project access, bounded reads/search, safe SVG styling, intact placement and transforms, and blank-project tool use. `e2e/resources.spec.ts` verifies metadata-only provider context, SVG preview and staged placement, measured placement through failed completion/review/cancellation, single-step undo/redo and refresh reuse, cross-project denial, and real PDF.js selected-page rendering and text extraction through the provider boundary. `e2e/svg-placement.spec.ts` measures final vectors and rasterized pixels in the browser: 40 mm off-center artwork at (50,30), aspect ratio, nonzero/nested viewBoxes and transforms, transformed drawing parents, hidden/definition exclusion, supported strokes/clips, canvas whitespace, explicit target selection and atomic failures.
- Agent feedback: `agent-activity.test.ts` checks ordered terminal states and restored interruptions; `stream.test.ts` checks progressive validated tool metadata; `drawing-agent.test.ts` checks execution/retry and in-flight validation events. The gated provider in `e2e/incremental.spec.ts` verifies immediate waiting feedback, pending tool calls before completion, sequential inspection, failures/retries, collapsed summaries, cancellation, interruption and persisted activity without committing staged changes early.
- Source tool arguments: `drawing-agent.test.ts` covers omitted/null read defaults, bounds, field-specific correction and safe schema/JSON error details. `e2e/incremental.spec.ts` verifies advertised nullable options through the real SDK/server and first-attempt reads, then corrects an invalid read using the returned feedback.
- Clarification changes: `user-input.test.ts`, `user-input-flow.test.ts`, `e2e/user-input.spec.ts`; check queued/follow-up calls, explicit submission, persisted drafts and retry IDs.
- Settings/projects/editor changes: `projects.test.ts`, `format-source.test.ts`, `e2e/model-selector.spec.ts`, `e2e/browser-restart.spec.ts` and the project switching, storage failure and code-editor cases in `e2e/studio.spec.ts`.
- Starter data: `starter-projects.test.ts` validates the four curated projects, references, histories and successful-only transcripts. `e2e/starter-projects.spec.ts` uses a fresh browser store to check initialization, all four sandbox previews, reload/draft persistence, sample deletion and existing-workspace preservation. Other browser regressions explicitly install an English-language mounting-plate workspace through `helpers/workspace-test.ts` to keep provider/edit scenarios independent of the shipped samples.
- Language changes: `i18n.test.ts` covers preference resolution, fallback, interpolation and unavailable storage; `messages.test.ts` checks response-language instructions and request validation. `e2e/language.spec.ts` exercises switching without resetting drafts/editor content, refresh restoration, Chinese IME confirmation, real provider clarification/continuation with stable tool IDs, Chinese export filenames, the Chinese default and saved language restoration and mobile header bounds. Keep UI translations in `src/lib/locales/`, interpolate whole messages, and leave user content and drawing source unchanged.
- Sidebar navigation: `e2e/sidebar.spec.ts` covers creation-time ordering across opening/editing/renaming and reload, long-list scrolling, name search, collapse, keyboard menus and rename, deletion confirmation, distinct blank names, the mobile drawer and per-project layer visibility in the canvas popover.
- Viewport layout: `e2e/viewport.spec.ts` checks root and panel bounds through desktop, tablet, mobile and short-window resizing, internal history/navigation/control scrolling, source-editor switching and canvas zoom/pan without page scrolling.
- Composer stability: `chat-composer.test.ts` rejects stale project draft echoes and late example updates, including edits undone to the original text. `e2e/chat-input.spec.ts` drives Chromium native IME composition through CDP while checking actual IndexedDB autosaves, text, focus, caret, input identity, per-project drafts and reload restoration. It also gates asynchronous examples to cover newer typing and switching away/back. `e2e/chat-workspace.spec.ts` checks IME Enter confirmation, committed-text sending, Shift/Enter behavior and attachment flows.
- Chat/workspace ownership: `e2e/chat-workspace.spec.ts` exercises background generation and validation while another drawing remains editable, project-owned commits/history, retry with original references, multiple attachment formats through the real provider boundary, attachment restoration and clearing, and the resizable floating object panel with selection synchronization. `attachments.test.ts`, `messages.test.ts` and `projects.test.ts` cover assistant-ui readers, metadata-only provider context, selected-page PDF previews, limits and persistence defaults.

Vitest defaults to jsdom for SVG DOM tests. Tests that run HTTP servers/streams use `// @vitest-environment node`. Fixtures in `tests/helpers/provider-stream.ts` provide real streamed completion/tool-call framing. Assert observable outcomes; avoid UI implementation snapshots.

To debug the UI, run a single browser case with `--headed` or `--debug`. Failure traces are retained under `test-results/`; open one with `npx playwright show-trace <trace.zip>`. In browser network tools, `/api/draw` must return SSE and a terminal `result` or `error`. Partial HTML in the transcript must remain text. If a drawing fails, inspect the safe UI error, hidden validation iframe, CSP and SVG scale/layer/ID rules. Never print credentials or complete credential-bearing request bodies.

For persistence bugs, use browser storage tools to inspect `draftline-projects` (projects and active metadata) and reproduce refresh/project switching with the fixture service. Separate editor undo from drawing undo. Large-image and quota behavior require the browser tests. Do not clear a user's site storage as a debugging shortcut.

For production issues, run `npm run build` then `npm start`; check `/api/health`, page CSP, static assets and `/licenses/codex/NOTICE.txt`. The build includes `.openai/hosting.json` metadata, but verification does not publish the site.

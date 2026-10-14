# Draftline — AI Drawing Studio

A working sketch → drawing → edit → SVG application. AI writes inline HTML, SVG, and synchronous JavaScript directly. The application validates and displays that code, then applies small SVG replacements for selected-element edits.

## Run locally

Requires Node.js 24.11+ and npm. All project files use UTF-8.

```powershell
npm ci
npm run dev
```

Open http://127.0.0.1:3000. The API runs on loopback port 3001. In **Model settings**, enter your OpenAI-compatible Base URL and API key, then discover models. Click the Model field or its arrow to browse the full list, type to filter, and select with the mouse or keyboard. Custom model IDs can also be typed and saved directly. Test the connection before drawing. Use an image-capable model for sketches.

OpenAI uses `https://api.openai.com/v1`. For [NewAPI](https://github.com/QuantumNous/new-api), use your instance's HTTPS URL including its API prefix, usually `/v1`. An empty URL path is normalized to `/v1`; custom prefixes are preserved. Development also accepts HTTP endpoints on localhost, useful for testing a local compatible provider. The production server accepts public HTTPS endpoints.

1. Use **New Drawing** in the left sidebar to start with an empty canvas and a fresh conversation. The starter project contains an example drawing to explore.
2. Describe a part and its dimensions in the right-side assistant. Attach, drop, or paste a PNG/JPEG/WebP reference up to 8 MB there. **Try an example** adds a real sketch and explicit measurements to the chat composer. Send to create the drawing; reply in the same chat if the model asks for a measurement.
3. Click a shape or dimension, then describe a change in the assistant. Clear selection for a whole-drawing edit. Use the hand tool to pan and the wheel or buttons to zoom.
4. Reopen drawings from the sidebar to continue their own conversation. Each project saves its drawing revisions, conversation, reference images, draft message, layer visibility and pending measurement clarification automatically in this browser. Use the pencil to rename a project and the trash button to delete it. Confirming deletion removes that drawing and conversation; deleting the last project opens a fresh drawing. Project navigation is available when the current AI request finishes or is stopped.
5. Export geometry only or a finished drawing with dimensions, title block, and technical notes. Layer visibility changes only the preview; export uses the original drawing.

Keyboard shortcuts: `V` select, `H` pan, `Ctrl/Cmd Z` undo, `Ctrl/Cmd Shift Z` redo, `Escape` clear selection, `Enter` send, `Shift Enter` newline. In the **Code** tab, CodeMirror 6 provides HTML/SVG and embedded JavaScript/CSS highlighting, line numbers, automatic word wrapping, indentation, search and editor undo/redo. Prettier automatically formats each committed drawing's source with two-space indentation and line breaks. Use **Format** to tidy a draft and **Apply code** to validate it in the drawing sandbox and update the preview. Formatting errors retain the draft; invalid drawings retain the current preview. Editor shortcuts apply to the source while the editor has focus.

## Streaming AI interaction

Ordinary conversation, missing-dimension clarification, drawing generation, selected-element edits, and model connection tests all use one end-to-end streaming transport. The official SDK requests Chat Completions with `stream: true`; Hono forwards each content delta immediately as SSE. Provider URL and model selection work with OpenAI-compatible and NewAPI endpoints. See [official OpenAI streaming documentation](https://developers.openai.com/api/docs/guides/streaming-responses).

The browser reads SSE with `eventsource-parser` and decodes display-only partial JSON with `partial-json`. Human-readable answers appear progressively as actual network content arrives. Generated HTML/SVG and patches appear as plain text while receiving. A terminal successful model completion and validated response are required before applying an edit. Complete generated HTML is executed and checked in a hidden isolated preview; only the verified SVG is committed to the visible canvas and undo history.

**Stop generation** cancels the browser request and its upstream model connection. Connection testing also supports streaming replies and cancellation. Interrupted connections, provider errors, malformed responses, token-limit truncation, and invalid SVG leave the current drawing intact and show an error. Partial or cancelled messages stay visible but are excluded from subsequent model history. Requests are not automatically replayed.

The server sends a heartbeat every 15 seconds and limits upstream inactivity to 120 seconds. The browser detects a connection that sends no bytes for 45 seconds; heartbeat bytes keep an active connection alive. Streaming responses use `Cache-Control: no-store, no-transform` and `X-Accel-Buffering: no`.

## Build and verify

```powershell
npm run check
npm test
npm run test:e2e
npm run build
npm start
```

Playwright uses installed Microsoft Edge by default. Set `PLAYWRIGHT_CHANNEL=chromium` and install Playwright Chromium if Edge is unavailable. The browser suite starts a local OpenAI-compatible test service and exercises the actual SDK and server; it requires no paid credentials. It checks image input, model discovery and connection tests, missing-dimension clarification, generated JavaScript, selected-element changes, undo/redo, layer visibility, exports, project context isolation, renaming and deletion, settings updates and clearing, storage failures, credential isolation and mobile layout. A persistent browser profile is closed and relaunched to verify drawing, conversation, draft, settings and 6 MB reference restoration across a full browser restart.

`npm start` serves the production build on loopback port 3000 (`PORT` overrides it). `dist/server/index.js` also exports a Cloudflare-compatible Worker `fetch` handler. The build embeds the small frontend assets into that module so Node and Worker deployments serve the same application. `.openai/hosting.json` identifies its private Sites deployment.

## Libraries and architecture

| Responsibility                         | Reused implementation                                                                 |
| -------------------------------------- | ------------------------------------------------------------------------------------- |
| UI and build                           | React, Vite, Lucide                                                                   |
| Accessible model selection             | [Headless UI Combobox](https://headlessui.com/react/combobox)                            |
| Source editing and formatting           | [CodeMirror 6](https://codemirror.net/), [Prettier standalone](https://prettier.io/docs/browser) |
| AI requests and custom API URLs        | [Official OpenAI JavaScript SDK](https://github.com/openai/openai-node) on the server |
| Stream framing and incremental display | Hono SSE, eventsource-parser, partial-json                                            |
| Portable API routing and body limits   | [Hono](https://github.com/honojs/hono), its Node adapter and body-limit middleware    |
| SVG and HTML sanitization              | [DOMPurify](https://github.com/cure53/DOMPurify)                                      |
| SVG zoom, pan and fit                  | [svg-pan-zoom](https://github.com/bumbu/svg-pan-zoom)                                 |
| Local project persistence              | [idb](https://github.com/jakearchibald/idb) with IndexedDB                              |
| Request and response contracts         | Zod                                                                                   |
| Unit and browser checks                | Vitest, jsdom, Playwright                                                             |

`server/app.ts` forwards user-configured credentials to the chosen provider. `server/stream.ts` handles streaming, cancellation, timeouts, error redaction and final response validation for every AI route. `src/lib/stream.ts` provides the shared browser transport, and `src/lib/stream-preview.ts` decodes partial responses for text display. `server/prompts.ts` contains the drawing contract. `src/lib/sandbox.ts` supplies the isolated preview and interaction bridge. `src/lib/drawing.ts` validates scale and layers, enforces patch boundaries, and serializes export. `src/lib/presentation.ts` lays out sheet information using native SVG and browser font measurement. React holds a bounded 30-revision undo history, including user-supplied manufacturing notes.

There is no custom CAD kernel. Native SVG represents paths, circles, curves and holes. JavaScript may construct SVG elements; after execution, a sanitized SVG snapshot becomes the stable, editable drawing source.

## Drawing contract

- Root: `<svg id="drawing" width="Wmm" height="Hmm" viewBox="x y W H">`. One coordinate unit equals one millimeter. Page size includes annotation margins.
- Two direct SVG groups: `geometry` with `data-layer="geometry"`, and `dimensions` with `data-layer="dimensions"`.
- A separate derived `presentation` group contains a bottom title block and technical notes. It uses the drawing title, mm units and 1:1 physical scale. Only explicitly supplied manufacturing requirements are added as notes, alongside a concise instruction to use stated dimensions. Text wraps and sections stack on narrow sheets. The page extends below the drawing while preserving every geometry coordinate. Geometry-only exports retain the original page bounds.
- All geometry shapes have unique stable IDs. Dimension groups have stable IDs and `data-for` references to related geometry IDs.
- Selected edits replace only that element and its related dimension groups, retain identities, and preserve unrelated geometry. Whole-drawing changes are permitted when selection is cleared.
- The model is instructed to ask for essential missing dimensions and choose a minimum sufficient set of annotations. Structure and physical scale are validated by the app; satisfying the requested geometric relationships remains the model's responsibility.
- Standalone exports preserve millimeter sizes, viewBox coordinates, geometry, markers, fonts, and inline presentation attributes. Zoom transforms and selection highlights belong to the preview.

## Credential and code isolation

**Model settings** saves the provider URL, API key and model in browser local storage and restores them on refresh or reopening. Save again to update them, or use **Clear saved settings** to remove all three and disconnect the model. The key field is masked by default. Credentials travel in request bodies to the app server and configured provider; they are excluded from drawing prompts, project records, exports, URLs and logs. Only save credentials on a browser profile you trust. API responses use `Cache-Control: no-store`; requests have body limits and origin checks.

Projects use IndexedDB through [idb](https://github.com/jakearchibald/idb), keeping reference images outside local storage's small quota. Each project has its own bounded undo history and conversation context. Restored drawing sources are rebuilt from validated, sanitized SVG snapshots; interrupted responses are marked stopped and excluded from AI context. A saved measurement clarification resumes with the current model settings. Storage failures show a visible warning and unsaved status so users can export their work. Browser storage belongs to the current origin and profile; clearing site data removes saved projects and credentials.

Generated code runs in an [iframe sandbox](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe) with only `allow-scripts`, giving it an opaque origin. Its CSP uses nonced inline scripts and blocks network connections, external images, fonts, workers, child frames, objects, forms and base URL changes. The parent CSP restricts frame navigation to the app origin. Frame messages are checked by source and an individual preview channel; the bridge provides drawing commands and sanitized SVG snapshots, never credentials. SVG sanitization also removes scripts, event attributes, foreign objects, CSS and external references from patches and exports.

Inline scripts are required to finish synchronously. This browser sandbox isolates credentials and origin access; it does not provide a CPU quota for arbitrary JavaScript. The app shows provider errors and invalid drawing responses without replacing the current drawing. Live paid-provider behavior requires the user's model credentials; automated checks use a deterministic compatible test service.

# Draftline — AI Drawing Studio

A working sketch → drawing → edit → SVG application. AI writes inline HTML, SVG, and synchronous JavaScript directly. The application validates and displays that code, then applies small SVG replacements for selected-element edits.

## Run locally

Requires Node.js 24.11+ and npm. All project files use UTF-8.

```powershell
npm ci
npm run dev
```

Open http://127.0.0.1:3000. The API runs on loopback port 3001. In **Model settings**, enter your OpenAI-compatible Base URL, API key, and model. Discover models or type a model ID, then test the connection. Use an image-capable model for sketches.

OpenAI uses `https://api.openai.com/v1`. For [NewAPI](https://github.com/QuantumNous/new-api), use your instance's HTTPS URL including its API prefix, usually `/v1`. An empty URL path is normalized to `/v1`; custom prefixes are preserved. Development also accepts HTTP endpoints on localhost, useful for testing a local compatible provider. The production server accepts public HTTPS endpoints.

1. Upload, drop, or paste a PNG/JPEG/WebP sketch up to 8 MB, or describe a part using dimensions. **Try an example** loads a real sketch and explicit measurements.
2. Generate the drawing. If the model asks for a measurement, reply in the assistant panel to continue the same request.
3. Click a shape or dimension, then describe a change. Clear selection for a whole-drawing edit. Use the hand tool to pan and the wheel or buttons to zoom.
4. Export geometry only or include annotations. Layer visibility changes only the preview; export uses the original drawing.

Keyboard shortcuts: `V` select, `H` pan, `Ctrl/Cmd Z` undo, `Ctrl/Cmd Shift Z` redo, `Escape` clear selection, `Enter` send, `Shift Enter` newline. Drawing source can also be edited in the **Code** tab.

## Build and verify

```powershell
npm run check
npm test
npm run test:e2e
npm run build
npm start
```

Playwright uses installed Microsoft Edge by default. Set `PLAYWRIGHT_CHANNEL=chromium` and install Playwright Chromium if Edge is unavailable. The browser suite starts a local OpenAI-compatible test service and exercises the actual SDK and server; it requires no paid credentials. It checks image input, model discovery and connection tests, missing-dimension clarification, generated JavaScript, selected-element changes, undo/redo, layer visibility, exports, local restoration, credential isolation, and mobile layout.

`npm start` serves the production build on loopback port 3000 (`PORT` overrides it). `dist/server/index.js` also exports a Cloudflare-compatible Worker `fetch` handler. The build embeds the small frontend assets into that module so Node and Worker deployments serve the same application. `.openai/hosting.json` identifies its private Sites deployment.

## Libraries and architecture

| Responsibility                       | Reused implementation                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------------------- |
| UI and build                         | React, Vite, Lucide                                                                   |
| AI requests and custom API URLs      | [Official OpenAI JavaScript SDK](https://github.com/openai/openai-node) on the server |
| Portable API routing and body limits | [Hono](https://github.com/honojs/hono), its Node adapter and body-limit middleware    |
| SVG and HTML sanitization            | [DOMPurify](https://github.com/cure53/DOMPurify)                                      |
| SVG zoom, pan and fit                | [svg-pan-zoom](https://github.com/bumbu/svg-pan-zoom)                                 |
| Request and response contracts       | Zod                                                                                   |
| Unit and browser checks              | Vitest, jsdom, Playwright                                                             |

`server/app.ts` forwards user-configured credentials to the chosen provider and returns a validated drawing, clarification, or patch response. `server/prompts.ts` contains the drawing contract. `src/lib/sandbox.ts` supplies the isolated preview and interaction bridge. `src/lib/drawing.ts` validates scale and layers, enforces patch boundaries, and serializes export. React holds a bounded 30-revision undo history.

There is no custom CAD kernel. Native SVG represents paths, circles, curves and holes. JavaScript may construct SVG elements; after execution, a sanitized SVG snapshot becomes the stable, editable drawing source.

## Drawing contract

- Root: `<svg id="drawing" width="Wmm" height="Hmm" viewBox="x y W H">`. One coordinate unit equals one millimeter. Page size includes annotation margins.
- Two direct SVG groups: `geometry` with `data-layer="geometry"`, and `dimensions` with `data-layer="dimensions"`.
- All geometry shapes have unique stable IDs. Dimension groups have stable IDs and `data-for` references to related geometry IDs.
- Selected edits replace only that element and its related dimension groups, retain identities, and preserve unrelated geometry. Whole-drawing changes are permitted when selection is cleared.
- The model is instructed to ask for essential missing dimensions and choose a minimum sufficient set of annotations. Structure and physical scale are validated by the app; satisfying the requested geometric relationships remains the model's responsibility.
- Standalone exports preserve millimeter sizes, viewBox coordinates, geometry, markers, fonts, and inline presentation attributes. Zoom transforms and selection highlights belong to the preview.

## Credential and code isolation

The API key lives only in parent-page React memory. The app saves provider URL/model and the latest sanitized SVG in browser local storage. Sketches and conversation history live in memory. Keys are sent to the app server and configured provider, excluded from prompts and responses, and never written to storage or logs. API responses use `Cache-Control: no-store`; requests have body limits and origin checks.

Generated code runs in an [iframe sandbox](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe) with only `allow-scripts`, giving it an opaque origin. Its CSP uses nonced inline scripts and blocks network connections, external images, fonts, workers, child frames, objects, forms and base URL changes. The parent CSP restricts frame navigation to the app origin. Frame messages are checked by source and an individual preview channel; the bridge provides drawing commands and sanitized SVG snapshots, never credentials. SVG sanitization also removes scripts, event attributes, foreign objects, CSS and external references from patches and exports.

Inline scripts are required to finish synchronously. This browser sandbox isolates credentials and origin access; it does not provide a CPU quota for arbitrary JavaScript. The app shows provider errors and invalid drawing responses without replacing the current drawing. Live paid-provider behavior requires the user's model credentials; automated checks use a deterministic compatible test service.

import { build } from "esbuild";
import {
  readFile,
  readdir,
  mkdir,
  copyFile,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { PAGE_CSP } from "../server/security.ts";

const assets = {};
await mkdir("dist/client/licenses/codex", { recursive: true });
for (const name of ["LICENSE", "NOTICE", "README.md"])
  await copyFile(
    `third_party/codex/${name}`,
    `dist/client/licenses/codex/${name}.txt`,
  );
await mkdir("dist/client/licenses/codex/apply-patch", { recursive: true });
for (const name of ["README.md", "build.json"])
  await copyFile(
    `third_party/codex/apply-patch/${name}`,
    `dist/client/licenses/codex/apply-patch/${name}.txt`,
  );
async function collect(directory, prefix = "") {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await collect(file, `${prefix}${entry.name}/`);
    else if (entry.name !== "_headers")
      assets[`/${prefix}${entry.name}`] = await readFile(file, "utf8");
  }
}
await collect("dist/client");
await writeFile(
  "dist/client/_headers",
  `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  Content-Security-Policy: ${PAGE_CSP}

/
  Cache-Control: no-cache

/index.html
  Cache-Control: no-cache

/assets/*
  Cache-Control: public, max-age=31536000, immutable
`,
  "utf8",
);
await mkdir("dist/server", { recursive: true });
await mkdir("dist/.openai", { recursive: true });
await copyFile(".openai/hosting.json", "dist/.openai/hosting.json");
await build({
  stdin: {
    contents: `
    import { createApp } from './server/app.ts';
    const assets = ${JSON.stringify(assets)};
    const app = createApp();
    const types = { js:'text/javascript; charset=utf-8', css:'text/css; charset=utf-8', svg:'image/svg+xml', html:'text/html; charset=utf-8' };
    app.get('*', c => {
      const requestPath = new URL(c.req.url).pathname;
      const key = assets[requestPath] ? requestPath : requestPath === '/' ? '/index.html' : null;
      if(!key) return c.text('Not found', 404);
      const extension = key.split('.').pop();
      c.header('Content-Type', types[extension] || 'text/plain; charset=utf-8');
      c.header('X-Content-Type-Options', 'nosniff');
      c.header('Referrer-Policy', 'no-referrer');
      c.header('Cache-Control', key.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
      c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
      if(extension === 'html') c.header('Content-Security-Policy', ${JSON.stringify(PAGE_CSP)});
      return c.body(assets[key]);
    });
    export default { fetch: app.fetch };
  `,
    resolveDir: process.cwd(),
    sourcefile: "worker-entry.ts",
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  outfile: "dist/server/index.js",
  minify: true,
});
console.log("Built portable Worker and Node server: dist/server/index.js");

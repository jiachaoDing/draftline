import { defineConfig, devices } from "@playwright/test";
const baseURL = `http://127.0.0.1:${process.env.DRAFTLINE_DEV_PORT || 3000}`;
export default defineConfig({
  testDir: "./tests/e2e",
  // Browser startup, cold Vite transforms and IndexedDB restart checks share
  // this workflow budget; assertions and the app's own timeouts remain bounded.
  timeout: 60_000,
  workers: Number(process.env.PLAYWRIGHT_WORKERS || 2),
  retries: 0,
  // Persistent-profile restarts own a browser process and an independent runner.
  projects: [
    { name: "browser-restart", testMatch: "**/browser-restart.spec.ts" },
    { name: "workspace", testIgnore: "**/browser-restart.spec.ts" },
  ],
  use: {
    ...devices["Desktop Chrome"],
    channel: process.env.PLAYWRIGHT_CHANNEL || "msedge",
    baseURL,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev",
    url: `${baseURL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});

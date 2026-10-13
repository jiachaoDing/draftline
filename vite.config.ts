import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { PAGE_CSP } from "./server/security.ts";
export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist/client", emptyOutDir: true },
  server: {
    host: "127.0.0.1",
    port: 3000,
    strictPort: true,
    headers: {
      "Content-Security-Policy": PAGE_CSP.replace(
        "connect-src 'self'",
        "connect-src 'self' ws://127.0.0.1:3000",
      ),
    },
    proxy: { "/api": "http://127.0.0.1:3001" },
  },
});

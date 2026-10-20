import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { PAGE_CSP } from "./server/security.ts";
export default defineConfig({
  plugins: [react()],
  optimizeDeps: { include: ["dxf"] },
  build: { outDir: "dist/client", emptyOutDir: true },
  server: {
    host: "127.0.0.1",
    port: Number(process.env.DRAFTLINE_DEV_PORT || 3000),
    strictPort: true,
    headers: {
      "Content-Security-Policy": PAGE_CSP.replace(
        "connect-src 'self'",
        `connect-src 'self' ws://127.0.0.1:${process.env.DRAFTLINE_DEV_PORT || 3000}`,
      ),
    },
    proxy: {
      "/api": `http://127.0.0.1:${process.env.DRAFTLINE_API_PORT || 3001}`,
    },
  },
});

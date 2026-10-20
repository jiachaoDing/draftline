import { serve } from "@hono/node-server";
import { createApp } from "./app";
const port = Number(process.env.DRAFTLINE_API_PORT || 3001);
serve({
  fetch: createApp(
    true,
    `http://127.0.0.1:${process.env.DRAFTLINE_DEV_PORT || 3000}`,
  ).fetch,
  port,
  hostname: "127.0.0.1",
});
console.log(`Draftline API: http://127.0.0.1:${port}`);

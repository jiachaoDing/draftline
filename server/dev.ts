import { serve } from "@hono/node-server";
import { createApp } from "./app";
serve({ fetch: createApp(true).fetch, port: 3001, hostname: "127.0.0.1" });
console.log("Draftline API: http://127.0.0.1:3001");

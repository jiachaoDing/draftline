import { serve } from "@hono/node-server";
import worker from "../dist/server/index.js";
const port = Number(process.env.PORT || 3000);
serve({ fetch: worker.fetch, port, hostname: "127.0.0.1" });
console.log(`Draftline: http://127.0.0.1:${port}`);

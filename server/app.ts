import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { configSchema, drawingRequestSchema } from "../src/lib/contracts";
import { createProvider, parseAIResult } from "./provider";
import { drawingMessages } from "./messages";
import { providerErrorMessage, streamAI } from "./stream";
import { requestUserInputTool } from "./user-input";
import { drawingTools, resourceTools } from "./drawing-tools";
import { resolveReasoningEffort } from "../src/lib/model-reasoning";

export function createApp(
  allowLocal = false,
  localOrigin = "http://127.0.0.1:3000",
) {
  const app = new Hono();
  app.use("/api/*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    c.header("X-Content-Type-Options", "nosniff");
    const origin = c.req.header("origin");
    const localPreview = allowLocal && origin === localOrigin;
    if (origin && origin !== new URL(c.req.url).origin && !localPreview)
      return c.json({ error: "Cross-origin requests are not allowed." }, 403);
    await next();
  });
  app.use(
    "/api/*",
    bodyLimit({
      maxSize: 12_000_000,
      onError: (c) =>
        c.json({ error: "The image or drawing is too large." }, 413),
    }),
  );
  app.get("/api/health", (c) => c.json({ ok: true }));
  app.post("/api/models", async (c) => {
    const config = configSchema.parse(await c.req.json());
    const client = createProvider(config, allowLocal);
    const models = await client.models.list({ signal: c.req.raw.signal });
    return c.json({ models: models.data.map((model) => model.id).sort() });
  });
  app.post("/api/test", async (c) => {
    const config = configSchema.parse(await c.req.json());
    if (!config.model) return c.json({ error: "Enter a model to test." }, 400);
    const client = createProvider(config, allowLocal);
    return streamAI(
      c,
      client,
      {
        model: config.model,
        reasoning_effort: resolveReasoningEffort(config),
        messages: [{ role: "user", content: "Reply with OK." }],
      },
      () => ({ ok: true, model: config.model }),
    );
  });
  app.post("/api/draw", async (c) => {
    const input = drawingRequestSchema.parse(await c.req.json());
    if (!input.config.model)
      return c.json({ error: "Choose a model in Model settings." }, 400);
    if (input.mode === "edit" && !input.svg)
      return c.json({ error: "Create a drawing before editing it." }, 400);
    const client = createProvider(input.config, allowLocal);
    return streamAI(
      c,
      client,
      {
        model: input.config.model,
        reasoning_effort: resolveReasoningEffort(input.config),
        tools: [
          requestUserInputTool,
          ...resourceTools,
          ...(input.mode === "edit" && input.source ? drawingTools : []),
        ],
        parallel_tool_calls: false,
        messages: drawingMessages(input),
      },
      parseAIResult,
      true,
      true,
    );
  });
  app.onError((error, c) => {
    if (error.name === "ZodError" || error instanceof SyntaxError)
      return c.json(
        { error: "Invalid request. Check your settings and input." },
        400,
      );
    return c.json({ error: providerErrorMessage(error) }, 502);
  });
  return app;
}

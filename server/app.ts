import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import OpenAI from "openai";
import { configSchema, drawingRequestSchema } from "../src/lib/contracts";
import { createProvider, parseAIResult } from "./provider";
import { DRAWING_PROMPT, EDIT_PROMPT } from "./prompts";

export function createApp(allowLocal = false) {
  const app = new Hono();
  app.use("/api/*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    c.header("X-Content-Type-Options", "nosniff");
    const origin = c.req.header("origin");
    const localPreview = allowLocal && origin === "http://127.0.0.1:3000";
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
    await client.chat.completions.create(
      {
        model: config.model,
        messages: [{ role: "user", content: "Reply with OK." }],
      },
      { signal: c.req.raw.signal },
    );
    return c.json({ ok: true, model: config.model });
  });
  app.post("/api/draw", async (c) => {
    const input = drawingRequestSchema.parse(await c.req.json());
    if (!input.config.model)
      return c.json({ error: "Choose a model in Model settings." }, 400);
    if (input.mode === "edit" && !input.svg)
      return c.json({ error: "Create a drawing before editing it." }, 400);
    const client = createProvider(input.config, allowLocal);
    const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
      {
        type: "text",
        text: `${input.instruction}\n${input.svg ? `Current SVG:\n${input.svg}\nSelected element: ${input.selectedId || "none; whole-drawing edit permitted"}` : ""}`,
      },
    ];
    if (input.image)
      content.push({
        type: "image_url",
        image_url: { url: input.image, detail: "high" },
      });
    const response = await client.chat.completions.create(
      {
        model: input.config.model,
        messages: [
          {
            role: "system",
            content: input.mode === "edit" ? EDIT_PROMPT : DRAWING_PROMPT,
          },
          ...input.history.map((message) => ({
            role: message.role,
            content: message.text,
          })),
          { role: "user", content },
        ],
      },
      { signal: c.req.raw.signal },
    );
    const message = response.choices[0]?.message;
    if (message?.refusal)
      return c.json(
        { error: "The model declined this request. Adjust your instructions." },
        422,
      );
    if (!message?.content)
      return c.json(
        {
          error:
            "The model returned no drawing. Check that it supports chat and image input.",
        },
        502,
      );
    return c.json(parseAIResult(message.content));
  });
  app.onError((error, c) => {
    if (error instanceof OpenAI.APIError) {
      const messages: Record<number, string> = {
        400: "The provider rejected the request. Check model compatibility and image support.",
        401: "The API key was rejected. Check your credentials.",
        403: "Your API key does not have access to this model.",
        404: "API endpoint or model not found. Check your Base URL and model.",
        429: "Provider rate limit or quota reached. Please try again later.",
      };
      return c.json(
        {
          error:
            messages[error.status || 0] ||
            "The AI provider is unavailable. Check your connection and try again.",
        },
        502,
      );
    }
    if (error.name === "ZodError" || error instanceof SyntaxError)
      return c.json(
        { error: "Invalid request. Check your settings and input." },
        400,
      );
    const safeMessages = [
      "Use a public HTTPS API URL.",
      "The model returned invalid JSON.",
      "The model returned an incomplete drawing response.",
    ];
    return c.json(
      {
        error: safeMessages.some((prefix) => error.message.startsWith(prefix))
          ? error.message
          : "Unable to connect to the AI provider. Check your Base URL and network.",
      },
      502,
    );
  });
  return app;
}

import { openDB, type DBSchema } from "idb";
import { z } from "zod";
import {
  drawingRequestSchema,
  notesSchema,
  pendingUserInputSchema,
  type Drawing,
  type ModelConfig,
  type ChatMessage,
} from "./contracts";
import { cleanDrawing, svgToHTML } from "./drawing";
import { EXAMPLE } from "./example";

export const defaultConfig: ModelConfig = {
  baseURL: "https://api.openai.com/v1",
  apiKey: "",
  model: "",
};
export function readConfig(): ModelConfig {
  try {
    const saved = JSON.parse(localStorage.getItem("draftline-model") || "{}");
    return Object.fromEntries(
      Object.entries(defaultConfig).map(([key, value]) => [
        key,
        typeof saved[key] === "string" ? saved[key] : value,
      ]),
    ) as ModelConfig;
  } catch {
    return { ...defaultConfig };
  }
}

const referenceSchema = z.object({
  name: z.string().max(500),
  data: drawingRequestSchema.shape.image.unwrap(),
});
const drawingSchema = z
  .object({
    title: z.string().max(120),
    svg: z.string().max(600_000),
    summary: z.string().max(3000),
    notes: notesSchema,
  })
  .transform((drawing): Drawing => {
    const svg = cleanDrawing(drawing.svg);
    return { ...drawing, svg, html: svgToHTML(svg) };
  });
const messageSchema = z
  .object({
    role: z.enum(["user", "assistant"]),
    text: z.string(),
    id: z.string().optional(),
    status: z
      .enum(["streaming", "validating", "complete", "cancelled", "error"])
      .optional(),
    code: z.string().optional(),
    received: z.number().optional(),
    reference: referenceSchema.optional(),
  })
  .transform((message) => ({
    ...message,
    status:
      message.status === "streaming" || message.status === "validating"
        ? ("cancelled" as const)
        : message.status,
  }));
export const projectSchema = z.object({
  id: z.string(),
  name: z.string().trim().min(1).max(120),
  renamed: z.boolean().default(false),
  updatedAt: z.number(),
  history: z
    .object({
      items: z.array(drawingSchema.nullable()).min(1).max(30),
      index: z.number().int().min(0),
    })
    .refine((h) => h.index < h.items.length),
  messages: z.array(messageSchema),
  sketch: referenceSchema.nullable(),
  chatInput: z.string(),
  clarification: drawingRequestSchema.omit({ config: true }).nullable(),
  userInput: pendingUserInputSchema.nullable().default(null),
  layers: z.object({
    geometry: z.boolean(),
    dimensions: z.boolean(),
    presentation: z.boolean(),
  }),
});
export type Project = Omit<z.infer<typeof projectSchema>, "messages"> & {
  messages: ChatMessage[];
};
export type ProjectContext = Omit<
  z.infer<typeof drawingRequestSchema>,
  "config" | "toolTurns"
> & { toolTurns?: z.infer<typeof drawingRequestSchema>["toolTurns"] };
export const welcome = {
  role: "assistant" as const,
  text: "Describe a part with its dimensions, or attach a reference sketch. I’ll create your drawing, then help you refine it.",
};
export function newProject(drawing: Drawing | null = null): Project {
  return {
    id: crypto.randomUUID(),
    name: drawing?.title || "Untitled drawing",
    renamed: false,
    updatedAt: Date.now(),
    history: { items: [drawing], index: 0 },
    messages: [{ ...welcome }],
    sketch: null,
    chatInput: "",
    clarification: null,
    userInput: null,
    layers: { geometry: true, dimensions: true, presentation: true },
  };
}
interface ProjectDB extends DBSchema {
  projects: { key: string; value: Project };
  meta: { key: string; value: string };
}
let database: ReturnType<typeof openDB<ProjectDB>> | undefined;
function db() {
  return (database ??= openDB<ProjectDB>("draftline-projects", 1, {
    upgrade(database) {
      database.createObjectStore("projects", { keyPath: "id" });
      database.createObjectStore("meta");
    },
    blocking() {
      void database?.then((db) => db.close());
      database = undefined;
    },
    terminated() {
      database = undefined;
    },
  }));
}
export async function saveProject(project: Project) {
  const database = await db();
  // Explicit fields exclude provider credentials and transient UI state.
  await database.put("projects", {
    id: project.id,
    name: project.name,
    renamed: project.renamed,
    updatedAt: project.updatedAt,
    history: project.history,
    messages: project.messages,
    sketch: project.sketch,
    chatInput: project.chatInput,
    clarification: project.clarification,
    userInput: project.userInput,
    layers: project.layers,
  });
}
export async function selectProject(id: string) {
  await (await db()).put("meta", id, "active");
}
export async function deleteProject(id: string) {
  await (await db()).delete("projects", id);
}
let loading: Promise<Awaited<ReturnType<typeof readProjects>>> | undefined;
export function loadProjects() {
  return (loading ??= readProjects().finally(() => {
    loading = undefined;
  }));
}
async function readProjects() {
  const database = await db();
  const records = await database.getAll("projects");
  const projects: Project[] = [];
  let invalid = 0;
  for (const record of records) {
    try {
      projects.push(projectSchema.parse(record));
    } catch {
      invalid++;
    }
  }
  if (!records.length) {
    let drawing = EXAMPLE;
    try {
      const saved = JSON.parse(
        localStorage.getItem("draftline-drawing") || "null",
      );
      if (saved)
        drawing = drawingSchema.parse({
          ...saved,
          summary: "Restored from this browser.",
        });
    } catch {
      /* Keep the starter drawing when old storage is invalid. */
    }
    const project = newProject(drawing);
    await saveProject(project);
    projects.push(project);
    try {
      localStorage.removeItem("draftline-drawing");
    } catch {
      /* IndexedDB has saved the drawing. */
    }
  }
  projects.sort((a, b) => b.updatedAt - a.updatedAt);
  const activeId = await database.get("meta", "active");
  return {
    projects,
    activeId: projects.some((p) => p.id === activeId)
      ? activeId!
      : projects[0]?.id,
    invalid,
  };
}

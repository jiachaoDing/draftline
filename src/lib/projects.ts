import { openDB, type DBSchema } from "idb";
import { z } from "zod";
import {
  drawingRequestSchema,
  notesSchema,
  pendingUserInputSchema,
  type Drawing,
  type ChatMessage,
} from "./contracts";
import { cleanDrawing, svgToHTML } from "./drawing";
import { EXAMPLE } from "./example";
import { drawingRevision } from "./ai-workflow";
import { agentActivitySchema, settleActivities } from "./agent-activity";

const referenceSchema = z.object({
  name: z.string().max(500),
  data: drawingRequestSchema.shape.image.unwrap(),
});
const drawingSchema = z
  .object({
    revision: z.string().min(1).max(200).optional(),
    title: z.string().max(120),
    svg: z.string().max(600_000),
    summary: z.string().max(3000),
    notes: notesSchema,
  })
  .transform((drawing): Drawing => {
    const svg = cleanDrawing(drawing.svg);
    const restored = { ...drawing, svg, html: svgToHTML(svg) };
    return { ...restored, revision: drawingRevision(restored) };
  });
const messageSchema = z
  .object({
    role: z.enum(["user", "assistant"]),
    text: z.string(),
    id: z.string().optional(),
    status: z
      .enum([
        "streaming",
        "validating",
        "reviewing",
        "complete",
        "cancelled",
        "error",
      ])
      .optional(),
    code: z.string().optional(),
    received: z.number().optional(),
    activities: z.array(agentActivitySchema).max(256).default([]),
    reference: referenceSchema.optional(),
  })
  .transform((message) => ({
    ...message,
    activities: settleActivities(message.activities, "cancelled"),
    status:
      message.status === "streaming" ||
      message.status === "validating" ||
      message.status === "reviewing"
        ? ("cancelled" as const)
        : message.status,
  }));
export const projectSchema = z
  .object({
    id: z.string(),
    name: z.string().trim().min(1).max(120),
    renamed: z.boolean().default(false),
    createdAt: z.number().optional(),
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
  })
  .transform((project) => ({
    ...project,
    createdAt: project.createdAt ?? project.updatedAt,
  }));
export type Project = Omit<z.infer<typeof projectSchema>, "messages"> & {
  messages: ChatMessage[];
};
export const welcome = {
  role: "assistant" as const,
  text: "Describe a part with its dimensions, or attach a reference sketch. I’ll create your drawing, then help you refine it.",
};
export function newProject(
  drawing: Drawing | null = null,
  existingNames: readonly string[] = [],
  untitledName = "Untitled drawing",
): Project {
  if (drawing)
    drawing = { ...drawing, revision: drawing.revision || crypto.randomUUID() };
  const names = new Set(existingNames.map((name) => name.toLocaleLowerCase()));
  let name = untitledName;
  let suffix = 2;
  while (names.has(name.toLocaleLowerCase()))
    name = `${untitledName} ${suffix++}`;
  const createdAt = Date.now();
  return {
    id: crypto.randomUUID(),
    name: drawing?.title || name,
    renamed: false,
    createdAt,
    updatedAt: createdAt,
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
    createdAt: project.createdAt,
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
  projects.sort((a, b) => b.createdAt - a.createdAt);
  const activeId = await database.get("meta", "active");
  return {
    projects,
    activeId: projects.some((p) => p.id === activeId)
      ? activeId!
      : projects[0]?.id,
    invalid,
  };
}

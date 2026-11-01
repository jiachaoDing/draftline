import { z } from "zod";
import { newProject, projectSchema, type Project } from "./projects";

const backupSchema = z.object({
  format: z.literal("draftline-project"),
  version: z.literal(1),
  project: projectSchema,
});

export function exportProjectBackup(project: Project): string {
  return JSON.stringify({
    format: "draftline-project",
    version: 1,
    project: projectSchema.parse(project),
  });
}

export function importProjectBackup(
  text: string,
  names: readonly string[],
): Project {
  const { project } = backupSchema.parse(JSON.parse(text));
  const identity = newProject(null, names, project.name);
  const remapMessage = <Message extends Project["messages"][number]>(
    message: Message,
  ) => ({
    ...message,
    ...(message.recovery
      ? { recovery: { ...message.recovery, projectId: identity.id } }
      : {}),
  });
  return {
    ...project,
    id: identity.id,
    name: identity.name,
    renamed: true,
    createdAt: identity.createdAt,
    updatedAt: identity.updatedAt,
    messages: project.messages.map(remapMessage),
    conversation: {
      ...project.conversation,
      nodes: project.conversation.nodes.map((node) => ({
        ...node,
        message: remapMessage(node.message),
      })),
    },
  };
}

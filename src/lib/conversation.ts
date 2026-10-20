import { ExportedMessageRepository } from "@assistant-ui/react";
import type { ChatMessage, Drawing } from "./contracts";
import { runtimeMessage } from "./chat-runtime";
import type { Project } from "./projects";
import { pushHistory } from "./history";
import { drawingRevision } from "./ai-workflow";

export function sameCanvas(left: Drawing | null, right: Drawing | null) {
  return (
    left === right ||
    (!!left && !!right && drawingRevision(left) === drawingRevision(right))
  );
}

export type Conversation = {
  headId: string | null;
  nodes: { parentId: string | null; message: ChatMessage & { id: string } }[];
};

/** Upsert the visible path; siblings stay in assistant-ui's portable repository. */
export function recordConversation(
  messages: ChatMessage[],
  previous?: Conversation,
): Conversation {
  const nodes = new Map(previous?.nodes.map((node) => [node.message.id, node]));
  let parentId: string | null = null;
  for (const item of messages) {
    const message = { ...item, id: item.id || crypto.randomUUID() };
    nodes.set(message.id, { parentId, message });
    parentId = message.id;
  }
  return { headId: parentId, nodes: [...nodes.values()] };
}

export function conversationPath(
  conversation: Conversation,
  headId = conversation.headId,
) {
  const nodes = new Map(
    conversation.nodes.map((node) => [node.message.id, node]),
  );
  const path: ChatMessage[] = [];
  const seen = new Set<string>();
  while (headId !== null) {
    if (seen.has(headId)) throw new Error("Invalid conversation branch.");
    seen.add(headId);
    const node = nodes.get(headId);
    if (!node) throw new Error("Conversation message is missing.");
    path.push(node.message);
    headId = node.parentId;
  }
  return path.reverse();
}

export function runtimeRepository(conversation: Conversation) {
  return ExportedMessageRepository.fromBranchableArray(
    conversation.nodes.map(({ parentId, message }, index) => ({
      parentId,
      message: runtimeMessage(message, index),
    })),
    { headId: conversation.headId },
  );
}

export function restoreConversation(project: Project, headId: string): Project {
  const conversation =
    project.conversation || recordConversation(project.messages);
  const messages = conversationPath(conversation, headId);
  const head = messages.at(-1);
  const snapshot = [...messages]
    .reverse()
    .find((message) => message.canvas !== undefined);
  const canvas = snapshot?.canvas;
  const current = project.history.items[project.history.index];
  return {
    ...project,
    conversation: { ...conversation, headId },
    messages,
    history:
      canvas === undefined || sameCanvas(canvas, current)
        ? project.history
        : pushHistory(project.history, canvas),
    userInput: head?.userInput || null,
    clarification: head?.clarification || null,
  };
}

/** Saved linear conversations start with the best available historical snapshots. */
export function migrateConversation(
  messages: ChatMessage[],
  drawings: (Drawing | null)[],
  index: number,
) {
  let canvas = drawings[0];
  const migrated = messages.map((message, position) => {
    if (message.role === "assistant") {
      const match = drawings.find(
        (drawing) => drawing?.summary === message.text,
      );
      if (match) canvas = match;
    }
    return {
      ...message,
      canvas: position === messages.length - 1 ? drawings[index] : canvas,
    };
  });
  return recordConversation(migrated);
}

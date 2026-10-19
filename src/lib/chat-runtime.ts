import type {
  Attachment,
  CompleteAttachment,
  ThreadMessageLike,
} from "@assistant-ui/react";
import {
  attachmentSchema,
  type ChatAttachment,
  type ChatMessage,
} from "./contracts";

export function runtimeAttachment(item: ChatAttachment): CompleteAttachment {
  const { image, file, ...metadata } = item;
  return {
    id: item.id,
    name: item.name,
    type: image ? "image" : "document",
    contentType: image
      ? image.slice(5, image.indexOf(";"))
      : file
        ? "application/pdf"
        : "text/plain",
    status: { type: "complete" },
    content: [
      { type: "text", text: JSON.stringify(metadata) },
      ...(image ? [{ type: "image" as const, image }] : []),
      ...(file
        ? [
            {
              type: "file" as const,
              filename: item.name,
              mimeType: "application/pdf",
              data: file.slice(file.indexOf(",") + 1),
            },
          ]
        : []),
    ],
  };
}

export function savedAttachment(item: Attachment): ChatAttachment | undefined {
  const text = item.content?.find((part) => part.type === "text");
  if (!text || text.type !== "text") return;
  try {
    const image = item.content?.find((part) => part.type === "image");
    const file = item.content?.find((part) => part.type === "file");
    return attachmentSchema.parse({
      ...JSON.parse(text.text),
      image: image?.type === "image" ? image.image : undefined,
      file:
        file?.type === "file"
          ? `data:application/pdf;base64,${file.data}`
          : undefined,
    });
  } catch {
    return;
  }
}

export function runtimeMessage(
  message: ChatMessage,
  index: number,
): ThreadMessageLike {
  return {
    id: message.id || `message-${index}`,
    role: message.role,
    content: [{ type: "text", text: message.text }],
    attachments: message.attachments?.map(runtimeAttachment),
    status:
      message.role === "assistant"
        ? message.status === "streaming" || message.status === "validating"
          ? { type: "running" }
          : message.status === "error"
            ? { type: "incomplete", reason: "error" }
            : message.status === "cancelled"
              ? { type: "incomplete", reason: "cancelled" }
              : { type: "complete", reason: "stop" }
        : undefined,
    metadata: { custom: { draftline: message, index } },
  };
}

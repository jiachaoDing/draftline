import {
  CompositeAttachmentAdapter,
  SimpleImageAttachmentAdapter,
  SimpleTextAttachmentAdapter,
  type AttachmentAdapter,
} from "@assistant-ui/react";
import { attachmentSchema, type ChatAttachment } from "./contracts";

const images = new SimpleImageAttachmentAdapter();
images.accept = "image/png,image/jpeg,image/webp";
const text = new SimpleTextAttachmentAdapter();
text.accept +=
  ",image/svg+xml,.svg,.dxf,.txt,.md,.csv,.json,.xml,.yaml,.yml,.log";
const pdf: AttachmentAdapter = {
  accept: "application/pdf,.pdf",
  async add({ file }) {
    return {
      id: crypto.randomUUID(),
      type: "document",
      name: file.name,
      file,
      status: { type: "requires-action", reason: "composer-send" },
    };
  },
  async send(attachment) {
    const read = await images.send(attachment);
    const part = read.content[0];
    if (part?.type !== "image") throw new Error("This file could not be read.");
    const data = part.image;
    return {
      ...attachment,
      status: { type: "complete" },
      content: [
        {
          type: "file",
          filename: attachment.name,
          mimeType: "application/pdf",
          data: data.slice(data.indexOf(",") + 1),
        },
      ],
    };
  },
  async remove() {},
};
const files = new CompositeAttachmentAdapter([images, text, pdf]);
export const ATTACHMENT_ACCEPT = files.accept;

/** Built-in assistant-ui readers prepare images/text; PDF uses native file parts. */
export async function parseAttachment(file: File): Promise<ChatAttachment> {
  if (file.size > 8 * 1024 * 1024)
    throw new Error("Your sketch must be smaller than 8 MB.");
  const pending = await files.add({ file });
  // All three adapters return promises, rather than progressive generators.
  if (Symbol.asyncIterator in pending)
    throw new Error("This file could not be read.");
  const complete = await files.send(pending);
  const image = complete.content.find((part) => part.type === "image");
  const content = complete.content.find((part) => part.type === "text");
  const extension = file.name.split(".").at(-1)?.toLowerCase();
  const rawText =
    content?.type === "text"
      ? content.text.slice(
          content.text.indexOf(">\n") + 2,
          -"\n</attachment>".length,
        )
      : undefined;
  if (extension === "dxf" && rawText?.startsWith("AutoCAD Binary DXF"))
    throw new Error(
      "Choose an ASCII DXF file for text inspection and geometry previews.",
    );
  const textLimit = extension === "svg" ? 4 : extension === "dxf" ? 8 : 2;
  if (content?.type === "text" && file.size > textLimit * 1024 * 1024)
    throw new Error(
      `This ${extension || "text"} resource must be smaller than ${textLimit} MB.`,
    );
  const document = complete.content.find((part) => part.type === "file");
  return attachmentSchema.parse({
    id: complete.id,
    name: file.name || "Pasted sketch",
    size: file.size,
    type: image
      ? "image"
      : document
        ? "pdf"
        : extension === "svg"
          ? "svg"
          : extension === "dxf"
            ? "dxf"
            : "text",
    image: image?.type === "image" ? image.image : undefined,
    text: rawText,
    textFormat: content?.type === "text" ? "raw" : undefined,
    file:
      document?.type === "file"
        ? `data:application/pdf;base64,${document.data}`
        : undefined,
  });
}

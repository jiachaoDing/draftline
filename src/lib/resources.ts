import type { ChatAttachment, ChatMessage } from "./contracts";
import {
  resourceMetadataSchema,
  type ResourceMetadata,
} from "./resource-contracts";
import { sanitizeResourceSvg, svgResourceMetadata } from "./svg-resource";

/** The browser project's own records are the capability boundary; IDs never resolve globally. */
export function projectResources(
  project: {
    attachments: ChatAttachment[];
    messages: ChatMessage[];
    clarification?: { attachments?: ChatAttachment[] } | null;
    userInput?: { context: { attachments?: ChatAttachment[] } } | null;
  },
  extra: ChatAttachment[] = [],
): ChatAttachment[] {
  const items: ChatAttachment[] = [
    ...project.messages.flatMap((message) => message.attachments || []),
    ...project.messages.flatMap((message, index) =>
      message.reference
        ? [
            {
              id: `reference-${message.id || index}`,
              name: message.reference.name,
              type: "image" as const,
              size: Math.floor(message.reference.data.length * 0.75),
              image: message.reference.data,
            },
          ]
        : [],
    ),
    ...(project.clarification?.attachments || []),
    ...(project.userInput?.context.attachments || []),
    ...project.attachments,
    ...extra,
  ];
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

export function resourceText(item: ChatAttachment) {
  const text = item.text;
  if (text === undefined)
    throw new Error(
      "This binary resource has no text representation. Use inspect_resource with preview instead.",
    );
  // Saved assistant-ui text parts include their portable attachment envelope.
  return item.textFormat !== "raw" &&
    text.startsWith("<attachment name=") &&
    text.endsWith("\n</attachment>")
    ? text.slice(text.indexOf(">\n") + 2, -"\n</attachment>".length)
    : text;
}

export function resourceMetadata(item: ChatAttachment): ResourceMetadata {
  let details = {};
  if (item.type === "svg" && item.text) {
    try {
      details = svgResourceMetadata(sanitizeResourceSvg(resourceText(item)));
    } catch {
      /* The file stays readable; inspect/placement returns validation feedback. */
    }
  }
  return resourceMetadataSchema.parse({ ...item, ...details });
}

/** Rasterize only on explicit tool access, bounded independently of original file size. */
export async function resourcePreview(
  item: ChatAttachment,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  if (!item.image && item.type !== "svg")
    throw new Error(
      "No visual preview is available for this format. Read a bounded text segment instead.",
    );
  let url = item.image!;
  let temporary = false;
  if (item.type === "svg") {
    const svg = sanitizeResourceSvg(resourceText(item));
    const info = svgResourceMetadata(svg);
    const width = info.width && info.height ? info.width : info.viewBox?.[2];
    const height = info.width && info.height ? info.height : info.viewBox?.[3];
    if (!width || !height)
      throw new Error(
        "SVG preview requires a positive viewBox or explicit dimensions.",
      );
    const ratio = Math.min(1, 1024 / width, 1024 / height);
    svg.setAttribute("width", String(Math.max(1, Math.round(width * ratio))));
    svg.setAttribute("height", String(Math.max(1, Math.round(height * ratio))));
    if (!info.viewBox) svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    url = URL.createObjectURL(
      new Blob([new XMLSerializer().serializeToString(svg)], {
        type: "image/svg+xml",
      }),
    );
    temporary = true;
  }
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        image.onload = image.onerror = null;
      };
      const fail = (error: Error) => {
        cleanup();
        image.src = "";
        reject(error);
      };
      const abort = () => fail(new DOMException("Aborted", "AbortError"));
      const timer = setTimeout(
        () => fail(new Error("Resource preview timed out.")),
        6000,
      );
      image.onload = () => {
        cleanup();
        resolve();
      };
      image.onerror = () =>
        fail(new Error("This visual resource could not be decoded."));
      signal.addEventListener("abort", abort, { once: true });
      image.src = url;
    });
    signal.throwIfAborted();
    const scale = Math.min(
      1,
      1024 / image.naturalWidth,
      1024 / image.naturalHeight,
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Resource preview is unavailable.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return {
      resourceId: item.id,
      name: item.name,
      image: canvas.toDataURL("image/webp", 0.85),
    };
  } finally {
    if (temporary) URL.revokeObjectURL(url);
  }
}

import {
  AttachmentPrimitive,
  ComposerPrimitive,
  useAuiState,
} from "@assistant-ui/react";
import {
  FileText,
  Loader2,
  MousePointer2,
  Paperclip,
  Send,
  Square,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { t, useLocale } from "../lib/i18n";
import { useComposerText } from "./AssistantChat";

function Attachment() {
  const file = useAuiState((state) => state.attachment);
  const image = file.content?.find((part) => part.type === "image");
  return (
    <AttachmentPrimitive.Root
      className={`composer-attachment ${file.status.type}`}
    >
      {image?.type === "image" ? (
        <img src={image.image} alt={file.name} />
      ) : file.status.type === "running" ? (
        <Loader2 size={18} className="spin" />
      ) : (
        <FileText size={18} />
      )}
      <span>
        <AttachmentPrimitive.Name />
        {file.status.type === "incomplete" && (
          <small role="alert">
            {t(file.status.message || "This file could not be read.")}
          </small>
        )}
        {file.status.type === "running" && (
          <small>{t("Reading attachment…")}</small>
        )}
      </span>
      <AttachmentPrimitive.Remove
        aria-label={t("Remove attachment {{name}}", { name: file.name })}
      >
        <X size={13} />
      </AttachmentPrimitive.Remove>
    </AttachmentPrimitive.Root>
  );
}

type Props = {
  busy: boolean;
  selectionCount: number;
  onClearSelection: () => void;
  placeholder: string;
  children?: ReactNode;
};
export default function ChatComposer({
  busy,
  selectionCount,
  onClearSelection,
  placeholder,
  children,
}: Props) {
  useLocale();
  const text = useComposerText();
  const hasFailedAttachment = useAuiState((state) =>
    state.composer.attachments.some(
      (item) => item.status.type === "incomplete",
    ),
  );
  return (
    <ComposerPrimitive.Root className="chat-composer">
      <ComposerPrimitive.AttachmentDropzone
        className="composer-dropzone"
        disabled={busy}
      >
        <div className="composer-attachments">
          <ComposerPrimitive.Attachments components={{ Attachment }} />
        </div>
        {selectionCount > 0 && (
          <span className="composer-selection">
            <MousePointer2 size={12} />
            {t("{{count}} selected", { count: selectionCount })}
            <button
              type="button"
              aria-label={t("Clear AI selection context")}
              onClick={onClearSelection}
            >
              <X size={12} />
            </button>
          </span>
        )}
        <div className="composer-input">
          <ComposerPrimitive.Input
            // Keep React's controlled value ahead of assistant-ui's batched
            // projection, so autosave renders cannot reset native IME text.
            value={text}
            aria-label={t("Drawing instructions")}
            minRows={2}
            maxRows={7}
            placeholder={placeholder}
            disabled={busy}
            submitMode={hasFailedAttachment ? "none" : "enter"}
          />
          <div className="composer-bottom">
            <ComposerPrimitive.AddAttachment
              multiple
              aria-label={t("Attach files")}
              title={t("Attach files")}
              disabled={busy}
            >
              <Paperclip size={17} />
            </ComposerPrimitive.AddAttachment>
            <span>{t("Images, SVG, PDF, DXF, text")}</span>
            {busy ? (
              <ComposerPrimitive.Cancel aria-label={t("Stop generation")}>
                <Square size={13} fill="currentColor" />
              </ComposerPrimitive.Cancel>
            ) : (
              <ComposerPrimitive.Send
                aria-label={t("Send drawing instruction")}
                disabled={hasFailedAttachment}
              >
                <Send size={15} />
              </ComposerPrimitive.Send>
            )}
          </div>
        </div>
      </ComposerPrimitive.AttachmentDropzone>
      {children}
    </ComposerPrimitive.Root>
  );
}

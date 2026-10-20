import { t, useLocale } from "../lib/i18n";
import { createContext, useContext } from "react";
import {
  ArrowDown,
  ArrowLeft,
  Code2,
  Copy,
  RotateCcw,
  Sparkles,
  Pencil,
  History,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import {
  ActionBarPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAuiState,
  ComposerPrimitive,
  BranchPickerPrimitive,
} from "@assistant-ui/react";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import type { ChatMessage } from "../lib/contracts";
import AgentActivities from "./AgentActivities";
import { welcome } from "../lib/projects";

const Markdown = () => <MarkdownTextPrimitive />;
const RestoreContext = createContext<(id: string) => void>(() => {});

function EditMessage() {
  return (
    <ComposerPrimitive.Root className="message-edit">
      <ComposerPrimitive.Input aria-label={t("Edit message")} />
      <div className="message-actions">
        <ComposerPrimitive.Cancel>{t("Cancel")}</ComposerPrimitive.Cancel>
        <ComposerPrimitive.Send>
          {t("Save and regenerate")}
        </ComposerPrimitive.Send>
      </div>
    </ComposerPrimitive.Root>
  );
}

function Message() {
  useLocale();
  const metadata = useAuiState((state) => state.message.metadata.custom);
  const message = metadata.draftline as ChatMessage | undefined;
  const staged = !!message?.recovery?.session?.changed;
  const index = metadata.index as number;
  const role = useAuiState((state) => state.message.role);
  const running = useAuiState((state) => state.thread.isRunning);
  const restore = useContext(RestoreContext);
  if (!message)
    return (
      <MessagePrimitive.Root className={`chat-message ${role}`}>
        <div className="message-content">
          <MessagePrimitive.Parts components={{ Text: Markdown }} />
        </div>
      </MessagePrimitive.Root>
    );
  return (
    <MessagePrimitive.Root className={`chat-message ${message.role}`}>
      {message.role === "assistant" && (
        <div className="chat-avatar">
          <Sparkles size={12} />
        </div>
      )}
      <div className="message-content">
        {message.reference && (
          <figure className="message-reference">
            <img
              src={message.reference.data}
              alt={t("Reference: {{name}}", { name: message.reference.name })}
            />
            <figcaption>{message.reference.name}</figcaption>
          </figure>
        )}
        {message.attachments?.map((file) => (
          <figure className="message-reference" key={file.id}>
            {file.image && (
              <img
                src={file.image}
                alt={t("Reference: {{name}}", { name: file.name })}
              />
            )}
            <figcaption>
              {file.name} <small>{file.type.toUpperCase()}</small>
            </figcaption>
          </figure>
        ))}
        <div className="message-text">
          {index === 0 && message.text === welcome.text ? (
            t(welcome.text)
          ) : (
            <MessagePrimitive.Parts components={{ Text: Markdown }} />
          )}
          {!message.text &&
            !message.activities?.length &&
            message.status === "streaming" &&
            t("Connecting to your model…")}
        </div>
        {message.activities && (
          <AgentActivities
            activities={message.activities}
            active={
              message.status === "streaming" || message.status === "validating"
            }
          />
        )}
        {message.status === "streaming" && message.text && (
          <span className="stream-cursor" aria-hidden="true" />
        )}
        {message.code && (
          <details
            className="stream-code"
            open={message.status === "streaming"}
          >
            <summary>
              <Code2 size={12} />
              {t("Receiving drawing code ·")}{" "}
              {message.received?.toLocaleString()} {t("characters")}
            </summary>
            <pre>{message.code}</pre>
          </details>
        )}
        {message.status && message.status !== "complete" && (
          <small className={`reply-status ${message.status}`}>
            {message.status === "streaming"
              ? t(
                  message.activities?.some(
                    (step) =>
                      step.status === "running" && step.kind !== "model",
                  )
                    ? "Working on your drawing"
                    : "Waiting for model response",
                )
              : message.status === "validating"
                ? t("Checking the completed drawing")
                : message.status === "reviewing"
                  ? t("Review proposed changes before applying")
                  : message.status === "cancelled"
                    ? t("Stopped")
                    : message.recovery?.session?.changed
                      ? t(
                          "Completion failed — changes staged, not applied; continue from the failed step",
                        )
                      : t("Response incomplete — drawing unchanged")}
          </small>
        )}
        {message.error && (
          <div className="message-error" role="alert">
            {t(message.error)}
          </div>
        )}
        {(message.text ||
          message.status === "error" ||
          message.status === "cancelled") &&
          message.status !== "streaming" &&
          message.status !== "validating" && (
            <ActionBarPrimitive.Root className="message-actions">
              <ActionBarPrimitive.Copy
                aria-label={t("Copy message")}
                title={t("Copy message")}
              >
                <Copy size={13} />
              </ActionBarPrimitive.Copy>
              {message.role === "user" && (
                <ActionBarPrimitive.Edit
                  disabled={running}
                  aria-label={t("Edit message")}
                >
                  <Pencil size={13} />
                </ActionBarPrimitive.Edit>
              )}
              {message.id && (
                <button
                  disabled={running}
                  aria-label={t("Continue from here")}
                  title={t("Continue from here")}
                  onClick={() => restore(message.id!)}
                >
                  <History size={13} />
                </button>
              )}
              {message.role === "assistant" && index > 0 && (
                <ActionBarPrimitive.Reload
                  disabled={running}
                  aria-label={t(
                    staged
                      ? "Continue from failed step"
                      : message.status === "complete"
                        ? "Regenerate response"
                        : "Retry response",
                  )}
                >
                  <RotateCcw size={13} />
                  {t(
                    staged
                      ? "Continue from failed step"
                      : message.status === "complete"
                        ? "Regenerate"
                        : "Retry",
                  )}
                </ActionBarPrimitive.Reload>
              )}
              <BranchPickerPrimitive.Root
                className="branch-picker"
                hideWhenSingleBranch
              >
                <BranchPickerPrimitive.Previous
                  disabled={running}
                  aria-label={t("Previous version")}
                >
                  <ChevronLeft size={13} />
                </BranchPickerPrimitive.Previous>
                <BranchPickerPrimitive.Number /> /{" "}
                <BranchPickerPrimitive.Count />
                <BranchPickerPrimitive.Next
                  disabled={running}
                  aria-label={t("Next version")}
                >
                  <ChevronRight size={13} />
                </BranchPickerPrimitive.Next>
              </BranchPickerPrimitive.Root>
            </ActionBarPrimitive.Root>
          )}
      </div>
    </MessagePrimitive.Root>
  );
}

type Props = {
  messages: ChatMessage[];
  hasDrawing: boolean;
  onSuggest: (text: string) => void;
  onRestore: (id: string) => void;
};
export default function ChatTranscript({
  messages,
  hasDrawing,
  onSuggest,
  onRestore,
}: Props) {
  useLocale();
  return (
    <RestoreContext.Provider value={onRestore}>
      <ThreadPrimitive.Viewport className="assistant-content" autoScroll>
        {messages.length === 1 && (
          <div className="assistant-intro">
            <div className="intro-art">
              <span />
              <span />
              <span />
              <Sparkles size={18} />
            </div>
            <h3>{t("Your idea, engineered.")}</h3>
            <p>
              {t("Describe a part or a change in plain language.")}
              <br />
              {t("I’ll take care of the geometry.")}
            </p>
          </div>
        )}
        <ThreadPrimitive.Messages
          components={{ Message, EditComposer: EditMessage }}
        />
        {messages.length === 1 && (
          <div className="suggestions">
            <span>{t("TRY ASKING")}</span>
            {(hasDrawing
              ? [
                  "Make the plate 140 mm wide",
                  "Change all holes to Ø12 mm",
                  "Round the corners to R12",
                ]
              : [
                  "Draw a 100 × 60 mm plate with R5 corners",
                  "Create a Ø50 mm disk with a Ø10 center hole",
                ]
            ).map((text) => (
              <button key={text} onClick={() => onSuggest(t(text))}>
                {t(text)}
                <ArrowLeft size={12} />
              </button>
            ))}
          </div>
        )}
        <ThreadPrimitive.ScrollToBottom
          className="scroll-to-latest"
          aria-label={t("Scroll to latest message")}
        >
          <ArrowDown size={16} />
        </ThreadPrimitive.ScrollToBottom>
      </ThreadPrimitive.Viewport>
    </RestoreContext.Provider>
  );
}

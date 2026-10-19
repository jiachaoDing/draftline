import { t, useLocale } from "../lib/i18n";
import {
  ArrowDown,
  ArrowLeft,
  Code2,
  Copy,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import {
  ActionBarPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAuiState,
} from "@assistant-ui/react";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import type { ChatMessage } from "../lib/contracts";
import AgentActivities from "./AgentActivities";
import { welcome } from "../lib/projects";

const Markdown = () => <MarkdownTextPrimitive />;

function Message() {
  useLocale();
  const metadata = useAuiState((state) => state.message.metadata.custom);
  const message = metadata.draftline as ChatMessage | undefined;
  const index = metadata.index as number;
  const isLast = useAuiState((state) => state.message.isLast);
  const role = useAuiState((state) => state.message.role);
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
                    : t("Response incomplete — drawing unchanged")}
          </small>
        )}
        {message.text &&
          message.status !== "streaming" &&
          message.status !== "validating" && (
            <ActionBarPrimitive.Root className="message-actions">
              <ActionBarPrimitive.Copy
                aria-label={t("Copy message")}
                title={t("Copy message")}
              >
                <Copy size={13} />
              </ActionBarPrimitive.Copy>
              {isLast &&
                (message.status === "error" ||
                  message.status === "cancelled") && (
                  <ActionBarPrimitive.Reload aria-label={t("Retry response")}>
                    <RotateCcw size={13} />
                    {t("Retry")}
                  </ActionBarPrimitive.Reload>
                )}
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
};
export default function ChatTranscript({
  messages,
  hasDrawing,
  onSuggest,
}: Props) {
  useLocale();
  return (
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
      <ThreadPrimitive.Messages components={{ Message }} />
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
  );
}

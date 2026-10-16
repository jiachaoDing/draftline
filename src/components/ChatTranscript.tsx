import { t, useLocale } from "../lib/i18n";
import { useEffect, useRef } from "react";
import { ArrowLeft, Code2, Sparkles } from "lucide-react";
import type { ChatMessage } from "../lib/contracts";
import AgentActivities from "./AgentActivities";
import { welcome } from "../lib/projects";

type Props = {
  messages: ChatMessage[];
  hasDrawing: boolean;
  busy: boolean;
  validating: boolean;
  onSuggest: (text: string) => void;
};

export default function ChatTranscript({
  messages,
  hasDrawing,
  busy,
  validating,
  onSuggest,
}: Props) {
  useLocale();
  const transcript = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const panel = transcript.current;
    panel?.scrollTo({ top: panel.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);
  return (
    <div className="assistant-content" ref={transcript}>
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
      {messages.map((message, index) => (
        <div className={`chat-message ${message.role}`} key={index}>
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
                  alt={t("Reference: {{name}}", {
                    name: message.reference.name,
                  })}
                />
                <figcaption>{message.reference.name}</figcaption>
              </figure>
            )}
            <span className="message-text">
              {(index === 0 &&
              message.role === "assistant" &&
              message.text === welcome.text
                ? t(welcome.text)
                : message.text) ||
                (message.status === "streaming"
                  ? message.activities?.length
                    ? ""
                    : t("Connecting to your model…")
                  : message.status === "cancelled"
                    ? t("Generation stopped.")
                    : "")}
            </span>
            {message.activities && (
              <AgentActivities
                activities={message.activities}
                active={
                  message.status === "streaming" ||
                  message.status === "validating"
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
                  ? message.activities?.some(
                      (step) =>
                        step.status === "running" && step.kind !== "model",
                    )
                    ? t("Working on your drawing")
                    : t("Waiting for model response")
                  : message.status === "validating"
                    ? t("Checking the completed drawing")
                    : message.status === "reviewing"
                      ? t("Review proposed changes before applying")
                      : message.status === "cancelled"
                        ? t("Stopped")
                        : t("Response incomplete — drawing unchanged")}
              </small>
            )}
          </div>
        </div>
      ))}
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
      {busy && !messages.at(-1)?.activities?.length && (
        <div className="thinking">
          <span />
          <span />
          <span />{" "}
          {validating
            ? t("Validating geometry")
            : t("Receiving your model’s response")}
        </div>
      )}
    </div>
  );
}

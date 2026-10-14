// Web adaptation of Codex's RequestUserInputOverlay state machine (Apache-2.0).
// See third_party/codex/README.md for upstream sources and modifications.
// Copyright 2025 OpenAI
import { useEffect, useRef, type KeyboardEvent } from "react";
import { ArrowLeft, ArrowRight, CircleHelp, X } from "lucide-react";
import {
  collectAnswers,
  type Questionnaire,
  type UserInputArgs,
  type UserInputResponse,
} from "../lib/user-input";
import "./request-user-input.css";

type Props = {
  args: UserInputArgs;
  state: Questionnaire;
  disabled?: boolean;
  onChange: (state: Questionnaire) => void;
  onSubmit: (response: UserInputResponse) => void;
  onCancel: () => void;
};
export default function RequestUserInput({
  args,
  state,
  disabled,
  onChange,
  onSubmit,
  onCancel,
}: Props) {
  const root = useRef<HTMLDivElement>(null);
  const notes = useRef<HTMLTextAreaElement>(null);
  const question = args.questions[state.index];
  const answer = state.answers[state.index];
  const options = [
    ...question.options,
    {
      label: "None of the above",
      description: "Optionally, add details in notes (tab)",
    },
  ];
  useEffect(() => {
    root.current?.focus();
  }, [state.index]);
  const update = (patch: Partial<typeof answer>) =>
    onChange({
      ...state,
      answers: state.answers.map((a, i) =>
        i === state.index ? { ...a, ...patch } : a,
      ),
    });
  const move = (delta: number) =>
    onChange({
      ...state,
      index:
        (state.index + delta + args.questions.length) % args.questions.length,
    });
  const openNotes = () => {
    update({ notesVisible: true });
    requestAnimationFrame(() => notes.current?.focus());
  };
  const clearNotes = () => {
    update({ notes: "", notesVisible: false, committed: false });
    root.current?.focus();
  };
  const advance = (selected = answer.selected) => {
    if (selected === null && answer.notes.trim()) selected = 0;
    const next = {
      ...state,
      answers: state.answers.map((a, i) =>
        i === state.index
          ? { ...a, selected, committed: selected !== null }
          : a,
      ),
    };
    if (state.index < args.questions.length - 1)
      onChange({ ...next, index: state.index + 1 });
    else if (next.answers.some((a) => !a.committed))
      onChange({ ...next, confirmUnanswered: true });
    else onSubmit(collectAnswers(args, next));
  };
  const keyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    // Keep drawing shortcuts and IME confirmation out of this overlay.
    event.stopPropagation();
    if (disabled || event.nativeEvent.isComposing) return;
    if (state.confirmUnanswered) {
      if (event.key === "Escape") {
        event.preventDefault();
        onChange({ ...state, confirmUnanswered: false });
      }
      return;
    }
    const inNotes = event.target === notes.current;
    const inOptions =
      event.target === root.current ||
      (event.target as HTMLElement).getAttribute("role") === "radio";
    const key = event.key;
    if (
      (event.ctrlKey && ["p", "n"].includes(key)) ||
      ["PageUp", "PageDown"].includes(key)
    ) {
      event.preventDefault();
      move(key === "p" || key === "PageUp" ? -1 : 1);
      return;
    }
    if (key === "Escape") {
      event.preventDefault();
      if (answer.notesVisible) clearNotes();
      else onCancel();
    } else if (key === "Enter" && !event.shiftKey) {
      // Buttons use their native activation; the list itself follows Codex Enter behavior.
      if (
        !inNotes &&
        !inOptions &&
        (event.target as HTMLElement).tagName === "BUTTON"
      )
        return;
      event.preventDefault();
      if (
        !inNotes &&
        answer.selected === question.options.length &&
        !answer.notesVisible
      )
        openNotes();
      else advance();
    } else if (key === "Tab" && !event.shiftKey && (inNotes || inOptions)) {
      event.preventDefault();
      if (inNotes) clearNotes();
      else openNotes();
    } else if (["ArrowUp", "ArrowDown"].includes(key)) {
      event.preventDefault();
      update({
        selected:
          ((answer.selected ?? 0) +
            (key === "ArrowUp" ? -1 : 1) +
            options.length) %
          options.length,
        committed: false,
      });
    } else if (!inNotes && inOptions) {
      if (["ArrowLeft", "ArrowRight", "h", "l"].includes(key)) {
        event.preventDefault();
        move(key === "ArrowLeft" || key === "h" ? -1 : 1);
      } else if (/^[1-9]$/.test(key) && Number(key) <= options.length) {
        event.preventDefault();
        advance(Number(key) - 1);
      } else if (["Backspace", "Delete"].includes(key)) {
        event.preventDefault();
        update({
          selected: null,
          notes: "",
          notesVisible: false,
          committed: false,
        });
      } else if (key === " ") {
        event.preventDefault();
        update({ committed: answer.selected !== null });
      } else if (
        key.length === 1 &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        event.preventDefault();
        update({
          notesVisible: true,
          notes: answer.notes + key,
          committed: false,
        });
        requestAnimationFrame(() => notes.current?.focus());
      }
    }
  };

  return (
    <div
      className="user-input-panel"
      role="region"
      aria-label="Question from assistant"
      tabIndex={-1}
      ref={root}
      onKeyDown={keyboard}
    >
      <div className="user-input-heading">
        <span>
          <CircleHelp size={15} /> Input needed
        </span>
        <button
          aria-label="Cancel questions"
          disabled={disabled}
          onClick={onCancel}
        >
          <X size={15} />
        </button>
      </div>
      {state.confirmUnanswered ? (
        <div className="user-input-confirm" role="alert">
          <h3>Submit with unanswered questions?</h3>
          <p>
            {state.answers.filter((a) => !a.committed).length} unanswered. Only
            explicitly submitted answers will be sent.
          </p>
          <div className="user-input-actions">
            <button
              autoFocus
              disabled={disabled}
              onClick={() =>
                onChange({
                  ...state,
                  confirmUnanswered: false,
                  index: state.answers.findIndex((a) => !a.committed),
                })
              }
            >
              Go back
            </button>
            <button
              className="primary"
              disabled={disabled}
              onClick={() => onSubmit(collectAnswers(args, state))}
            >
              Proceed
            </button>
          </div>
        </div>
      ) : (
        <>
          <nav className="user-input-progress" aria-label="Questions">
            {args.questions.map((q, i) => (
              <button
                key={q.id}
                disabled={disabled}
                aria-current={i === state.index ? "step" : undefined}
                onClick={() => onChange({ ...state, index: i })}
              >
                {state.answers[i].committed ? "✓ " : ""}
                {q.header}
              </button>
            ))}
            <span>
              {state.index + 1} / {args.questions.length}
            </span>
          </nav>
          <h3 id="user-input-question">{question.question}</h3>
          <div
            role="radiogroup"
            aria-labelledby="user-input-question"
            className="user-input-options"
          >
            {options.map((option, i) => (
              <button
                type="button"
                role="radio"
                aria-checked={answer.selected === i}
                disabled={disabled}
                tabIndex={answer.selected === i ? 0 : -1}
                key={i}
                onClick={() => {
                  update({
                    selected: i,
                    committed: false,
                    ...(i === question.options.length
                      ? { notesVisible: true }
                      : {}),
                  });
                  root.current?.focus();
                  if (i === question.options.length)
                    requestAnimationFrame(() => notes.current?.focus());
                }}
              >
                <span className="user-input-number">{i + 1}.</span>
                <span>
                  <strong>{option.label}</strong>
                  <small>{option.description}</small>
                </span>
              </button>
            ))}
          </div>
          {answer.notesVisible ? (
            <textarea
              ref={notes}
              aria-label="Answer notes"
              placeholder="Add notes"
              rows={2}
              disabled={disabled}
              maxLength={8000}
              value={answer.notes}
              onChange={(event) =>
                update({ notes: event.target.value, committed: false })
              }
            />
          ) : (
            <button
              className="user-input-notes-toggle"
              disabled={disabled}
              onClick={openNotes}
            >
              Add notes or a custom answer
            </button>
          )}
          <div className="user-input-actions">
            <button
              disabled={disabled || args.questions.length === 1}
              onClick={() => move(-1)}
            >
              <ArrowLeft size={13} /> Back
            </button>
            <button
              disabled={disabled || args.questions.length === 1}
              onClick={() => move(1)}
            >
              Next <ArrowRight size={13} />
            </button>
            <button
              className="primary"
              disabled={disabled}
              onClick={() => advance()}
            >
              {state.index === args.questions.length - 1
                ? "Submit answers"
                : "Submit answer"}
            </button>
          </div>
          <p className="user-input-hints">
            ↑↓ select · ←→ questions · Tab notes · Enter submit · Esc interrupt
          </p>
        </>
      )}
    </div>
  );
}

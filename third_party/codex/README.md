# OpenAI Codex attribution

DraftLine adapts code from [openai/codex](https://github.com/openai/codex) at commit
[`2f05c0a71f59fb2f05800846351f3e9926c3e52b`](https://github.com/openai/codex/tree/2f05c0a71f59fb2f05800846351f3e9926c3e52b).
Copyright 2025 OpenAI. Licensed under Apache License 2.0; see [LICENSE](LICENSE)
and the upstream [NOTICE](NOTICE), reproduced here.

Adapted sources:

- `codex-rs/core/src/tools/handlers/request_user_input_spec.rs`: tool name,
  parameter descriptions, option normalization and question contract.
- `codex-rs/protocol/src/request_user_input.rs`: question, option and response types.
- `codex-rs/tui/src/bottom_pane/request_user_input/mod.rs`: `AnswerState`,
  `reset_for_request`, `move_question`, `select_current_option`,
  `go_next_or_submit`, `submit_answers`, unanswered confirmation and key handling.
- `codex-rs/tui/src/bottom_pane/request_user_input/{render,layout}.rs`: question
  progress, option descriptions, notes, submit/navigation controls and hints.

Modified files: `server/user-input.ts`, `src/lib/user-input.ts`, and
`src/components/RequestUserInput.tsx`. Rust state and interaction logic are
translated into TypeScript/React; layout uses DraftLine CSS, native controls,
accessible radio semantics and mouse navigation. Tool requests use the existing
OpenAI-compatible Chat Completions transport. Each question initially highlights
the first option; only explicitly submitted answers are returned. Notes use the
upstream `user_note: ` prefix; the client appends “None of the above”.

DraftLine waits for explicit user submission, preserves pending questions and
drafts in project storage, and resumes with assistant `tool_calls` and matching
`tool` messages. Multiple calls in a completion are queued. The web transport
validates bounded arguments, unique question/call IDs and matching answers.
Browser Tab traversal is retained on buttons; Tab from the question area enters
notes, and Tab/Escape in notes clears them and returns to options. The UI also
provides visible navigation and cancellation controls.

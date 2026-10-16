# OpenAI Codex attribution

The original Rust incremental patch engine and supporting browser tool loop are
documented in [apply-patch/README.md](apply-patch/README.md), pinned to commit
`c22a06c18070c3e33bd2648c7210a00a2a9f6f80`. Source copies, adaptations, fixture
tests and WASM/source hashes are included in that directory. The license and
notice below apply to both integrations.

Agent activity presentation follows the paired call lifecycle in
[`codex-rs/protocol/src/protocol.rs`](https://github.com/openai/codex/blob/c22a06c18070c3e33bd2648c7210a00a2a9f6f80/codex-rs/protocol/src/protocol.rs)
(`PatchApplyBegin`/`PatchApplyEnd`, call identity and terminal status) and compact
activity/detail disclosure in
[`codex-rs/tui/src/history_cell/mod.rs`](https://github.com/openai/codex/blob/c22a06c18070c3e33bd2648c7210a00a2a9f6f80/codex-rs/tui/src/history_cell/mod.rs)
at the patch engine's pinned commit. `src/lib/agent-activity.ts` and
`src/components/AgentActivities.tsx` implement these patterns for DraftLine's
existing SSE and browser tool executor using React, Lucide and native HTML
disclosure controls. Streamed tool metadata denotes pending work; actual
execution and validation callbacks determine running and terminal states.
DraftLine includes bounded tool feedback and excludes model reasoning from this
activity view.

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
upstream `user_note: ` prefix; the client appends one “Custom answer” choice.
Its identity is the index after the predefined options. Custom text and optional
notes have separate per-question drafts. Custom selection immediately reveals
and focuses its textarea; submission requires non-whitespace text and returns
the actual answer, with optional notes as a second entry. Tool instructions
request concrete predefined answers and allow an empty options array for exact
measurements. Saved records default the custom draft to an empty string.

DraftLine waits for explicit user submission, preserves pending questions and
drafts in project storage, and resumes with assistant `tool_calls` and matching
`tool` messages. Multiple calls in a completion are queued. The web transport
validates bounded arguments, unique question/call IDs and matching answers.
Browser Tab traversal is retained on buttons; Tab from the question area enters
notes or focuses the selected custom input, and Tab/Escape in notes clears them
and returns to options. Escape from custom input returns to options while
retaining its draft. Arrow keys in either textarea move the caret;
PageUp/PageDown and Ctrl P/N navigate questions. The UI provides visible
navigation, skip and cancellation controls. These web adaptations follow the
client-owned other choice, per-question draft restoration and explicit
submission conventions in the upstream
[request-user-input state machine](https://github.com/openai/codex/tree/main/codex-rs/tui/src/bottom_pane/request_user_input).

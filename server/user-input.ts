// Adapted from codex-rs/core/src/tools/handlers/request_user_input_spec.rs.
// OpenAI Codex, Apache-2.0; see third_party/codex/README.md.
// Copyright 2025 OpenAI
import type OpenAI from "openai";

export const requestUserInputTool: OpenAI.Chat.Completions.ChatCompletionTool =
  {
    type: "function",
    function: {
      name: "request_user_input",
      description:
        "Request user input for one to three short questions and wait for the response. Use to clarify essential drawing measurements or user preferences before drawing.",
      strict: false,
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["questions"],
        properties: {
          questions: {
            type: "array",
            description:
              "Questions to show the user. Prefer 1 and do not exceed 3",
            minItems: 1,
            maxItems: 3,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["id", "header", "question", "options"],
              properties: {
                id: {
                  type: "string",
                  description:
                    "Stable identifier for mapping answers (snake_case).",
                },
                header: {
                  type: "string",
                  description:
                    "Short header label shown in the UI (12 or fewer chars).",
                },
                question: {
                  type: "string",
                  description: "Single-sentence prompt shown to the user.",
                },
                options: {
                  type: "array",
                  description:
                    'Provide 2-3 mutually exclusive choices. Put the recommended option first and suffix its label with "(Recommended)". Do not include an "Other" option in this list; the client will add a free-form "Other" option automatically.',
                  minItems: 1,
                  maxItems: 3,
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["label", "description"],
                    properties: {
                      label: {
                        type: "string",
                        description: "User-facing label (1-5 words).",
                      },
                      description: {
                        type: "string",
                        description:
                          "One short sentence explaining impact/tradeoff if selected.",
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  };

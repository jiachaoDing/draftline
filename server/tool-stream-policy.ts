import { z } from "zod";
import { ModelFailure } from "../src/lib/model-failure";

const chunkSchema = z.object({
  choices: z.array(
    z.object({
      index: z.number(),
      delta: z.object({
        refusal: z.string().nullish(),
        tool_calls: z
          .array(
            z.object({
              index: z.number(),
              id: z.string().optional(),
              function: z
                .object({ arguments: z.string().optional() })
                .optional(),
            }),
          )
          .optional(),
      }),
    }),
  ),
});

/** Enforce app limits before SDK normalization can repair duplicate provider IDs. */
export function toolStreamPolicy(allowTools: boolean, argumentLimit: number) {
  const calls = new Map<number, { id?: string; length: number }>();
  return (raw: unknown) => {
    const chunk = chunkSchema.safeParse(raw);
    if (!chunk.success) return;
    for (const choice of chunk.data.choices) {
      if (choice.index !== 0) continue;
      if (choice.delta.refusal)
        throw new ModelFailure(
          "The model declined this request. Adjust your instructions.",
        );
      for (const call of choice.delta.tool_calls || []) {
        if (
          !allowTools ||
          call.index < 0 ||
          call.index > 3 ||
          !Number.isInteger(call.index)
        )
          throw new ModelFailure(
            "The model returned an unsupported tool call.",
          );
        const previous = calls.get(call.index) || { length: 0 };
        const id = call.id || previous.id;
        const length =
          previous.length + (call.function?.arguments?.length || 0);
        if (length > argumentLimit || (id?.length || 0) > 200)
          throw new ModelFailure("The model returned an oversized tool call.");
        if (
          id &&
          [...calls].some(
            ([index, item]) => index !== call.index && item.id === id,
          )
        )
          throw new ModelFailure(
            "The model reused a tool call ID. Please try again.",
          );
        calls.set(call.index, { id, length });
      }
    }
  };
}

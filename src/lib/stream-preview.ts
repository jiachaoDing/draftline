import { parse, Allow } from "partial-json";

export type StreamPreview = { text: string };
/** Partial JSON is display-only. Only the server-validated result may change the drawing. */
export function previewStream(source: string): StreamPreview {
  try {
    const partial = parse(
      source
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, ""),
      Allow.OBJ | Allow.ARR | Allow.STR,
    );
    const text =
      [partial?.message, partial?.question, partial?.summary].find(
        (value) => typeof value === "string",
      ) || "";
    return { text };
  } catch {
    return { text: "" };
  }
}

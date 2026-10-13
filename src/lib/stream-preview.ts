import { parse, Allow } from "partial-json";

export type StreamPreview = { text: string; code: string };
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
    const code =
      typeof partial?.html === "string"
        ? partial.html
        : Array.isArray(partial?.patches)
          ? partial.patches
              .map((patch: { id?: string; svg?: string }) =>
                typeof patch?.svg === "string"
                  ? `${patch.id || "Selected element"}\n${patch.svg}`
                  : "",
              )
              .filter(Boolean)
              .join("\n\n")
          : "";
    return { text, code };
  } catch {
    return { text: "", code: "" };
  }
}

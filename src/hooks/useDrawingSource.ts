import { useEffect, useState } from "react";
import { formatDrawingSource } from "../lib/format-source";
import type { Drawing } from "../lib/contracts";

export function useDrawingSource(
  drawing: Drawing | null,
  tell: (text: string, error?: boolean) => void,
) {
  const [code, setCode] = useState("");
  const [formattingCode, setFormattingCode] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const source = drawing?.html || "";
    setCode(source);
    if (!source) return;
    formatDrawingSource(source).then(
      (formatted) => {
        if (!cancelled)
          setCode((current) => (current === source ? formatted : current));
      },
      () => {
        if (!cancelled)
          tell(
            "Source could not be formatted. You can still edit and apply it.",
            true,
          );
      },
    );
    return () => {
      cancelled = true;
    };
  }, [drawing, tell]);

  async function formatCode() {
    const source = code;
    setFormattingCode(true);
    try {
      const formatted = await formatDrawingSource(source);
      setCode((current) => (current === source ? formatted : current));
    } catch (error) {
      tell(`Could not format source. ${(error as Error).message}`, true);
    } finally {
      setFormattingCode(false);
    }
  }
  return { code, setCode, formattingCode, formatCode };
}

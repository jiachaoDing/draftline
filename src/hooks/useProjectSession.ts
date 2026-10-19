import { useMemo, useRef, useState, type SetStateAction } from "react";
import type { Drawing } from "../lib/contracts";
import type { DrawingChanges } from "../lib/drawing-changes";
import type { DrawingContext } from "../lib/ai-workflow";

function newSession() {
  return {
    busy: false,
    pending: null as Omit<Drawing, "svg"> | null,
    review: null as { drawing: Drawing; changes: DrawingChanges } | null,
    abort: { current: null as AbortController | null },
    reply: { current: null as string | null },
    retry: { current: null as DrawingContext | null },
    editContext: {
      current: null as { drawing: Drawing | null; ids: string[] } | null,
    },
  };
}
type Session = ReturnType<typeof newSession>;

/** Only transient execution state lives here. Messages/drawings stay in Project. */
export function useProjectSession(id: string) {
  const sessions = useRef(new Map<string, Session>());
  const [, render] = useState(0);
  // Lazy initialization creates stable task handles, never copies rendered state.
  if (!sessions.current.has(id)) sessions.current.set(id, newSession());
  const session = sessions.current.get(id)!;
  const actions = useMemo(() => {
    function setter<K extends "busy" | "pending" | "review">(key: K) {
      return (value: SetStateAction<Session[K]>) => {
        session[key] =
          typeof value === "function" ? value(session[key]) : value;
        render((version) => version + 1);
      };
    }
    return {
      setBusy: setter("busy"),
      setPending: setter("pending"),
      setReview: setter("review"),
    };
  }, [session]);
  return { ...session, ...actions, sessions: sessions.current };
}

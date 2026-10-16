import { t, useLocale } from "../lib/i18n";
import {
  forwardRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";
import { buildSandbox } from "../lib/sandbox";
import { cleanDrawing, listElements, sanitizeSVG } from "../lib/drawing";
import {
  EMPTY_SELECTION,
  selectionSchema,
  type SelectionState,
  type Snapshot,
} from "../lib/contracts";

export type PreviewHandle = { send: (type: string, payload?: unknown) => void };
type Props = {
  title?: string;
  html: string;
  onSnapshot: (snapshot: Snapshot) => void;
  onSelection: (selection: SelectionState) => void;
  onCommand?: (command: string) => void;
  onError: (message: string) => void;
  onZoom: (zoom: number) => void;
  selection?: SelectionState;
  locked?: boolean;
  changedIds?: string[];
  layers: { geometry: boolean; dimensions: boolean; presentation: boolean };
  mode: "select" | "pan";
};
export const Preview = forwardRef<PreviewHandle, Props>(
  function Preview(props, ref) {
    useLocale();
    const frame = useRef<HTMLIFrameElement>(null);
    const currentProps = useRef(props);
    currentProps.current = props;
    const channel = useMemo(() => crypto.randomUUID(), [props.html]);
    const srcDoc = useMemo(
      () => buildSandbox(props.html, channel),
      [props.html, channel],
    );
    const send = useCallback(
      (type: string, payload?: unknown) =>
        frame.current?.contentWindow?.postMessage(
          { channel, type, payload },
          "*",
        ),
      [channel],
    );
    useImperativeHandle(ref, () => ({ send }), [send]);
    // Install the source/channel-checked bridge during commit, before the
    // srcdoc frame can publish its first snapshot. Activity/autosave renders
    // can otherwise postpone passive effects beyond the frame's startup.
    useLayoutEffect(() => {
      let ready = false;
      const timer = setTimeout(() => {
        if (!ready)
          currentProps.current.onError(
            "Drawing preview did not finish. Try generating again.",
          );
      }, 6000);
      const handle = (event: MessageEvent) => {
        if (
          event.source !== frame.current?.contentWindow ||
          event.data?.channel !== channel
        )
          return;
        const { type, payload } = event.data;
        if (
          type === "snapshot" &&
          typeof payload === "string" &&
          payload.length <= 600_000
        ) {
          try {
            const svg = cleanDrawing(payload);
            currentProps.current.onSnapshot({
              svg,
              elements: listElements(sanitizeSVG(svg)),
            });
          } catch (error) {
            currentProps.current.onError((error as Error).message);
          }
        }
        if (type === "selection") {
          const selection = selectionSchema.safeParse(payload);
          if (selection.success)
            currentProps.current.onSelection(selection.data);
        }
        if (
          type === "command" &&
          typeof payload === "string" &&
          !currentProps.current.locked
        )
          currentProps.current.onCommand?.(payload);
        if (
          type === "zoom" &&
          typeof payload === "number" &&
          Number.isFinite(payload)
        )
          currentProps.current.onZoom(payload);
        if (type === "error" && typeof payload === "string")
          currentProps.current.onError(payload.slice(0, 1000));
        if (type === "ready") {
          ready = true;
          clearTimeout(timer);
          const p = currentProps.current;
          send("layers", p.layers);
          send("mode", p.mode);
          send("select", p.selection || EMPTY_SELECTION);
          send("locked", !!p.locked);
          send("changes", p.changedIds || []);
        }
      };
      window.addEventListener("message", handle);
      return () => {
        clearTimeout(timer);
        window.removeEventListener("message", handle);
      };
    }, [channel, send]);
    useEffect(() => send("layers", props.layers), [props.layers, send]);
    useEffect(
      () => send("select", props.selection || EMPTY_SELECTION),
      [props.selection, send],
    );
    useEffect(() => send("locked", !!props.locked), [props.locked, send]);
    useEffect(
      () => send("changes", props.changedIds || []),
      [props.changedIds, send],
    );
    useEffect(() => send("mode", props.mode), [props.mode, send]);
    return (
      <iframe
        ref={frame}
        title={props.title || t("Technical drawing preview")}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        srcDoc={srcDoc}
      />
    );
  },
);

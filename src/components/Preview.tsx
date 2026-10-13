import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";
import { buildSandbox } from "../lib/sandbox";
import { cleanDrawing, listElements, sanitizeSVG } from "../lib/drawing";
import type { Snapshot } from "../lib/contracts";

export type PreviewHandle = { send: (type: string, payload?: unknown) => void };
type Props = {
  html: string;
  onSnapshot: (snapshot: Snapshot) => void;
  onSelection: (id: string | null) => void;
  onError: (message: string) => void;
  onZoom: (zoom: number) => void;
  selectedId: string | null;
  layers: { geometry: boolean; dimensions: boolean; presentation: boolean };
  mode: "select" | "pan";
};
export const Preview = forwardRef<PreviewHandle, Props>(
  function Preview(props, ref) {
    const frame = useRef<HTMLIFrameElement>(null);
    const currentProps = useRef(props);
    currentProps.current = props;
    const channel = useMemo(() => crypto.randomUUID(), [props.html]);
    const srcDoc = useMemo(
      () => buildSandbox(props.html, channel),
      [props.html, channel],
    );
    const send = (type: string, payload?: unknown) =>
      frame.current?.contentWindow?.postMessage(
        { channel, type, payload },
        "*",
      );
    useImperativeHandle(ref, () => ({ send }), [channel]);
    useEffect(() => {
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
        if (
          type === "selection" &&
          (typeof payload === "string" || payload === null)
        )
          currentProps.current.onSelection(payload);
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
          send("select", p.selectedId);
        }
      };
      window.addEventListener("message", handle);
      return () => {
        clearTimeout(timer);
        window.removeEventListener("message", handle);
      };
    }, [channel]);
    useEffect(() => send("layers", props.layers), [props.layers, channel]);
    useEffect(
      () => send("select", props.selectedId),
      [props.selectedId, channel],
    );
    useEffect(() => send("mode", props.mode), [props.mode, channel]);
    return (
      <iframe
        ref={frame}
        title="Technical drawing preview"
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        srcDoc={srcDoc}
      />
    );
  },
);

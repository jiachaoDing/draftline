import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Code2,
  FileCode2,
  Focus,
  Hand,
  Layers2,
  Loader2,
  Maximize,
  Minus,
  MousePointer2,
  Plus,
  Redo2,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Square,
  Undo2,
  X,
} from "lucide-react";
import ModelSettings from "./components/ModelSettings";
import SketchUpload, { type Sketch } from "./components/SketchUpload";
import { Preview, type PreviewHandle } from "./components/Preview";
import {
  applyPatches,
  cleanDrawing,
  downloadFile,
  exportSVG,
  presentationSVG,
  svgToHTML,
} from "./lib/drawing";
import { EXAMPLE } from "./lib/example";
import { pushHistory, type History } from "./lib/history";
import { requestDrawing } from "./lib/api";
import { previewStream } from "./lib/stream-preview";
import type {
  ChatMessage,
  Drawing,
  DrawingRequest,
  ElementInfo,
  ModelConfig,
  Snapshot,
} from "./lib/contracts";

const initialConfig: ModelConfig = (() => {
  try {
    const stored = JSON.parse(localStorage.getItem("draftline-model") || "{}");
    return {
      baseURL:
        typeof stored.baseURL === "string"
          ? stored.baseURL
          : "https://api.openai.com/v1",
      model: typeof stored.model === "string" ? stored.model : "",
      apiKey: "",
    };
  } catch {
    return { baseURL: "https://api.openai.com/v1", model: "", apiKey: "" };
  }
})();
function initialDrawing() {
  try {
    const saved = JSON.parse(
      localStorage.getItem("draftline-drawing") || "null",
    );
    if (saved?.svg && typeof saved.title === "string") {
      const svg = cleanDrawing(saved.svg);
      return {
        svg,
        title: saved.title.slice(0, 120),
        html: svgToHTML(svg),
        summary: "Restored from this browser.",
        notes: Array.isArray(saved.notes)
          ? saved.notes
              .filter(
                (note: unknown): note is string => typeof note === "string",
              )
              .slice(0, 6)
              .map((note: string) => note.trim().slice(0, 400))
              .filter(Boolean)
          : [],
      };
    }
  } catch {
    /* Invalid stored drawing is replaced by the example. */
  }
  return EXAMPLE;
}
const welcome: ChatMessage = {
  role: "assistant",
  text: "Start with a sketch and a few dimensions. I’ll turn them into a precise vector drawing, and ask if anything is unclear.",
};

export default function App() {
  const [config, setConfig] = useState(initialConfig);
  const [settings, setSettings] = useState(false);
  const [history, setHistory] = useState<History<Drawing>>(() => ({
    items: [initialDrawing()],
    index: 0,
  }));
  const drawing = history.items[history.index];
  const [pending, setPending] = useState<Omit<Drawing, "svg"> | null>(null);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const [sketch, setSketch] = useState<Sketch | null>(null);
  const [instruction, setInstruction] = useState("");
  const [elements, setElements] = useState<ElementInfo[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = elements.find((el) => el.id === selectedId);
  const [layers, setLayers] = useState({
    geometry: true,
    dimensions: true,
    presentation: true,
  });
  const previewHTML = useMemo(
    () => svgToHTML(presentationSVG(drawing.svg, drawing)),
    [drawing],
  );
  const [mode, setMode] = useState<"select" | "pan">("select");
  const [zoom, setZoom] = useState(100);
  const [messages, setMessages] = useState<ChatMessage[]>([welcome]);
  const [chatInput, setChatInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{
    text: string;
    error?: boolean;
  } | null>(null);
  const [clarification, setClarification] = useState<DrawingRequest | null>(
    null,
  );
  const [exportOpen, setExportOpen] = useState(false);
  const [tab, setTab] = useState<"drawing" | "code">("drawing");
  const [code, setCode] = useState(drawing.html);
  const [help, setHelp] = useState(false);
  const preview = useRef<PreviewHandle>(null);
  const abort = useRef<AbortController | null>(null);
  const activeReply = useRef<string | null>(null);
  const chatEnd = useRef<HTMLDivElement>(null);
  const exporting = useRef<HTMLDivElement>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const tell = useCallback((text: string, error = false) => {
    clearTimeout(noticeTimer.current);
    setNotice({ text, error });
    noticeTimer.current = setTimeout(
      () => setNotice(null),
      error ? 10000 : 4500,
    );
  }, []);

  const commit = useCallback((next: Drawing) => {
    setHistory((h) => pushHistory(h, next));
    setSelectedId(null);
    setElements([]);
    setClarification(null);
    setTab("drawing");
  }, []);
  const finishReply = useCallback(
    (status: ChatMessage["status"], text?: string, keepCode = false) => {
      const id = activeReply.current;
      if (id)
        setMessages((messages) =>
          messages.map((message) =>
            message.id === id
              ? {
                  ...message,
                  status,
                  text: text ?? message.text,
                  code: keepCode ? message.code : undefined,
                }
              : message,
          ),
        );
      if (status !== "validating") activeReply.current = null;
    },
    [],
  );
  const cancelGeneration = () => {
    if (abort.current) abort.current.abort();
    else if (pendingRef.current) {
      pendingRef.current = null;
      setPending(null);
      setBusy(false);
      finishReply("cancelled", undefined, true);
      tell("Generation stopped.");
    }
  };
  useEffect(() => {
    try {
      localStorage.setItem(
        "draftline-drawing",
        JSON.stringify({
          title: drawing.title,
          svg: drawing.svg,
          notes: drawing.notes || [],
        }),
      );
    } catch {
      tell("Browser storage is full. Export your drawing to keep it.", true);
    }
    setCode(drawing.html);
  }, [drawing, tell]);
  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);
  useEffect(
    () => () => {
      abort.current?.abort();
      clearTimeout(noticeTimer.current);
    },
    [],
  );
  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!exporting.current?.contains(event.target as Node))
        setExportOpen(false);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  const loadFile = useCallback(
    (file: File) => {
      if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
        return tell("Choose a PNG, JPEG, or WebP image.", true);
      if (file.size > 8 * 1024 * 1024)
        return tell("Your sketch must be smaller than 8 MB.", true);
      const reader = new FileReader();
      reader.onload = () => {
        setSketch({
          data: String(reader.result),
          name: file.name || "Pasted sketch",
        });
        setClarification(null);
        tell(
          "Sketch added. Include any important dimensions before generating.",
        );
      };
      reader.onerror = () =>
        tell("This image could not be read. Please try another file.", true);
      reader.readAsDataURL(file);
    },
    [tell],
  );
  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      if (busy || settings) return;
      const image = [...(event.clipboardData?.items || [])]
        .find((item) => item.type.startsWith("image/"))
        ?.getAsFile();
      if (image) {
        event.preventDefault();
        loadFile(image);
      }
    };
    document.addEventListener("paste", paste);
    return () => document.removeEventListener("paste", paste);
  }, [loadFile, busy, settings]);
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (
        (event.target as HTMLElement).closest("input,textarea,dialog") ||
        busy ||
        pending
      )
        return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        setHistory((h) => ({
          ...h,
          index: Math.max(
            0,
            Math.min(h.items.length - 1, h.index + (event.shiftKey ? 1 : -1)),
          ),
        }));
        setSelectedId(null);
      }
      if (event.key === "Escape") {
        setSelectedId(null);
        setExportOpen(false);
      }
      if (event.key.toLowerCase() === "v") setMode("select");
      if (event.key.toLowerCase() === "h") setMode("pan");
    };
    document.addEventListener("keydown", keyboard);
    return () => document.removeEventListener("keydown", keyboard);
  }, [busy, pending]);

  const onSnapshot = useCallback(
    (snapshot: Snapshot) => {
      setElements(snapshot.elements);
      if (pendingRef.current) {
        const candidate = pendingRef.current;
        pendingRef.current = null;
        setPending(null);
        commit({
          ...candidate,
          svg: snapshot.svg,
          html: svgToHTML(snapshot.svg),
        });
        setBusy(false);
        finishReply("complete");
        tell("Drawing is ready. Click an element to refine it.");
      }
    },
    [commit, finishReply, tell],
  );
  const onPreviewError = useCallback(
    (text: string) => {
      if (pendingRef.current) {
        pendingRef.current = null;
        setPending(null);
        setBusy(false);
        const id = activeReply.current;
        setMessages((messages) =>
          messages.map((message) =>
            message.id === id
              ? {
                  ...message,
                  status: "error",
                  text: `${message.text}\n\nThe drawing could not be applied. ${text}`,
                }
              : message,
          ),
        );
        activeReply.current = null;
      }
      tell(text, true);
    },
    [tell],
  );

  async function runAI(input: DrawingRequest) {
    if (abort.current || pendingRef.current) return;
    if (!config.apiKey || !config.model) {
      setSettings(true);
      tell("Connect an AI model to start drawing.");
      return;
    }
    setBusy(true);
    setNotice(null);
    setClarification(null);
    const controller = new AbortController();
    abort.current = controller;
    const replyId = crypto.randomUUID();
    activeReply.current = replyId;
    setMessages((messages) => [
      ...messages,
      { id: replyId, role: "assistant", text: "", status: "streaming" },
    ]);
    let source = "";
    let updateFrame: number | undefined;
    const flush = (retainReceivedText = false) => {
      updateFrame = undefined;
      if (
        (!retainReceivedText && controller.signal.aborted) ||
        abort.current !== controller
      )
        return;
      const partial = previewStream(source);
      setMessages((messages) =>
        messages.map((message) =>
          message.id === replyId
            ? {
                ...message,
                text: partial.text || message.text,
                code: partial.code ? partial.code.slice(-8000) : message.code,
                received: source.length,
              }
            : message,
        ),
      );
    };
    try {
      const result = await requestDrawing(
        { ...input, config },
        controller.signal,
        (text) => {
          source += text;
          if (updateFrame === undefined)
            updateFrame = requestAnimationFrame(() => flush());
        },
      );
      if (updateFrame !== undefined) cancelAnimationFrame(updateFrame);
      flush();
      controller.signal.throwIfAborted();
      if (result.kind === "message") {
        finishReply("complete", result.message);
      } else if (result.kind === "clarification") {
        setClarification(input);
        finishReply("complete", result.question);
      } else if (result.kind === "patch") {
        if (!input.selectedId)
          throw new Error(
            "The model returned a targeted edit without a selected element. Try again.",
          );
        const svg = applyPatches(input.svg!, result.patches, input.selectedId);
        commit({
          title: drawing.title,
          svg,
          html: svgToHTML(svg),
          summary: result.summary,
          notes: drawing.notes,
        });
        finishReply("complete", result.summary);
        tell("Selected element updated.");
      } else {
        if (input.mode === "edit" && input.selectedId)
          throw new Error(
            "The model tried to replace the whole drawing during a selected edit. Clear selection for a whole-drawing edit.",
          );
        finishReply("validating", result.summary);
        const candidate = {
          title: result.title,
          html: result.html,
          summary: result.summary,
          notes: result.notes,
        };
        pendingRef.current = candidate;
        setPending(candidate);
        setTab("drawing");
        setSelectedId(null);
      }
    } catch (error) {
      if (updateFrame !== undefined) cancelAnimationFrame(updateFrame);
      flush(true);
      if (clarification) setClarification(input);
      if ((error as Error).name === "AbortError") {
        finishReply("cancelled", undefined, true);
        tell("Generation stopped. Your drawing is unchanged.");
      } else {
        tell((error as Error).message, true);
        setMessages((messages) =>
          messages.map((message) =>
            message.id === replyId
              ? {
                  ...message,
                  status: "error",
                  text: `${message.text}\n\n${(error as Error).message}`,
                }
              : message,
          ),
        );
        if (activeReply.current === replyId) activeReply.current = null;
      }
    } finally {
      if (updateFrame !== undefined) cancelAnimationFrame(updateFrame);
      if (abort.current === controller) {
        if (!pendingRef.current) setBusy(false);
        abort.current = null;
      }
    }
  }

  const generate = () => {
    if (!sketch && !instruction.trim())
      return tell(
        "Upload a sketch or describe a part with its dimensions.",
        true,
      );
    if (!config.apiKey || !config.model) {
      setSettings(true);
      return;
    }
    const text =
      instruction.trim() ||
      "Convert this sketch into a precise technical drawing. Read the handwritten dimensions and ask for anything essential that is unclear.";
    setMessages((m) => [
      ...m,
      {
        role: "user",
        text: `${sketch ? `Sketch: ${sketch.name}\n` : ""}${text}`,
      },
    ]);
    runAI({
      config,
      mode: "generate",
      instruction: text,
      image: sketch?.data,
      notes: [],
      history: [],
    });
  };
  const sendChat = () => {
    const text = chatInput.trim();
    if (!text || busy) return;
    if (!config.apiKey || !config.model) {
      setSettings(true);
      return;
    }
    setChatInput("");
    setMessages((m) => [...m, { role: "user", text }]);
    const context = messages
      .filter((message) => !message.status || message.status === "complete")
      .slice(-10)
      .map((m) => ({ role: m.role, text: m.text.slice(0, 8000) }));
    if (clarification)
      runAI({
        ...clarification,
        instruction: `${clarification.instruction}\nUser clarification: ${text}`,
        history: context,
      });
    else
      runAI({
        config,
        mode: "edit",
        instruction: text,
        svg: drawing.svg,
        selectedId: selectedId || undefined,
        notes: drawing.notes || [],
        history: context,
      });
  };
  const useExample = async () => {
    try {
      const image = new Image();
      image.src = "/example-sketch.svg";
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      canvas.getContext("2d")!.drawImage(image, 0, 0);
      setSketch({
        name: "mounting-plate-sketch.png",
        data: canvas.toDataURL("image/png"),
      });
      setInstruction(
        "120 × 80 mm plate, R8 corners. Four Ø10 holes; centers 20 mm from each edge.",
      );
      commit(EXAMPLE);
      setMessages([welcome]);
      tell(
        "Example sketch loaded. Connect your model and generate your own drawing.",
      );
    } catch {
      tell("The example image could not be loaded.", true);
    }
  };
  const exportDrawing = (annotations: boolean) => {
    try {
      downloadFile(
        exportSVG(drawing.svg, annotations, drawing),
        `${drawing.title.replace(/[^a-z0-9_-]/gi, "-").toLowerCase()}${annotations ? "-dimensioned" : ""}.svg`,
        "image/svg+xml;charset=utf-8",
      );
      tell("SVG exported at its original millimeter scale.");
    } catch (error) {
      tell((error as Error).message, true);
    }
    setExportOpen(false);
  };
  const navigate = (delta: number) => {
    setHistory((h) => ({ ...h, index: h.index + delta }));
    setSelectedId(null);
    setClarification(null);
  };

  return (
    <div className="app">
      <header className="app-header">
        <a className="brand" href="#" aria-label="Draftline home">
          <span className="brand-mark">
            <svg viewBox="0 0 30 30" fill="none">
              <path
                d="M7 23V7h8c7 0 11 7 7 13-2 3-5 3-8 3"
                stroke="currentColor"
                strokeWidth="2.5"
              />
              <path d="m7 23 12-12" stroke="currentColor" strokeWidth="1.7" />
            </svg>
          </span>
          <span>
            draftline<span className="brand-dot">.</span>
          </span>
        </a>
        <span className="header-divider" />
        <div className="project-name">
          Drawing studio <span className="beta">BETA</span>
        </div>
        <div className="header-actions">
          <span className="saved-indicator">
            <span /> Saved locally
          </span>
          <button
            className="button settings-button"
            aria-label="Model settings"
            onClick={() => setSettings(true)}
          >
            <Settings2 size={16} /> <span>Model settings</span>
            <span
              className={`connection-dot ${config.apiKey && config.model ? "connected" : ""}`}
            />
          </button>
          <div className="export-wrap" ref={exporting}>
            <button
              className="button primary"
              disabled={busy}
              onClick={() => setExportOpen(!exportOpen)}
            >
              <ArrowDownToLine size={16} /> Export SVG <ChevronDown size={14} />
            </button>
            {exportOpen && (
              <div className="export-menu">
                <div className="menu-label">EXPORT DRAWING</div>
                <button onClick={() => exportDrawing(true)}>
                  <FileCode2 size={17} />
                  <span>
                    With dimensions
                    <small>Dimensions, title & technical notes</small>
                  </span>
                  <ArrowRight size={14} />
                </button>
                <button onClick={() => exportDrawing(false)}>
                  <Layers2 size={17} />
                  <span>
                    Geometry only<small>Clean vector outlines</small>
                  </span>
                  <ArrowRight size={14} />
                </button>
                <p>Standalone SVG · true millimeter scale</p>
              </div>
            )}
          </div>
        </div>
      </header>
      <main className="studio">
        <aside className="left-panel">
          <div className="workflow-heading">
            <div className="eyebrow">
              <span /> YOUR WORKSPACE
            </div>
            <h1>Sketch to precision.</h1>
            <p>A rough idea. A drawing that adds up.</p>
          </div>
          <div className="workflow-steps">
            <span className="active">
              <b>1</b> Sketch
            </span>
            <ChevronRight size={12} />
            <span>
              <b>2</b> Refine
            </span>
            <ChevronRight size={12} />
            <span>
              <b>3</b> Export
            </span>
          </div>
          <section className="sketch-section">
            <div className="section-title">
              <span>Reference sketch</span>
              <span className="optional">OPTIONAL</span>
            </div>
            <SketchUpload
              sketch={sketch}
              onFile={loadFile}
              onClear={() => {
                setSketch(null);
                setClarification(null);
              }}
              disabled={busy}
            />
            <div className="section-title instructions-label">
              <label htmlFor="drawing-instructions">Drawing instructions</label>
              <CircleHelp
                size={14}
                aria-label="Include dimensions in millimeters"
              />
            </div>
            <textarea
              id="drawing-instructions"
              className="instruction-input"
              rows={4}
              value={instruction}
              disabled={busy}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="Add dimensions or describe your part…&#10;For example, a 100 × 60 mm plate with two Ø8 holes."
            />
            <div className="units-note">
              <span>All dimensions in millimeters</span>
              <span className="unit-tag">mm</span>
            </div>
            <button
              className="button primary generate-button"
              onClick={generate}
              disabled={busy}
            >
              {busy ? (
                <Loader2 size={17} className="spin" />
              ) : (
                <Sparkles size={17} />
              )}
              {busy ? "Creating your drawing…" : "Generate drawing"}
              {!busy && <ArrowRight size={16} />}
            </button>
            <button
              className="example-button"
              onClick={useExample}
              disabled={busy}
            >
              Just exploring?{" "}
              <span>
                Try an example <ArrowRight size={12} />
              </span>
            </button>
          </section>
          <section className="layers-section">
            <div className="section-title">
              <span>
                <Layers2 size={15} /> Drawing layers
              </span>
              <span className="layer-count">3</span>
            </div>
            {(["geometry", "dimensions", "presentation"] as const).map(
              (layer) => (
                <label key={layer} className="layer-row">
                  <span className={`layer-symbol ${layer}`} />
                  <span>
                    {layer === "geometry"
                      ? "Geometry"
                      : layer === "dimensions"
                        ? "Dimensions"
                        : "Sheet information"}
                    <small>
                      {layer === "geometry"
                        ? "Profiles, holes & curves"
                        : layer === "dimensions"
                          ? "Measurements & annotations"
                          : "Title, units & technical notes"}
                    </small>
                  </span>
                  <input
                    aria-label={`Show ${layer}`}
                    type="checkbox"
                    checked={layers[layer]}
                    onChange={(e) =>
                      setLayers({ ...layers, [layer]: e.target.checked })
                    }
                  />
                </label>
              ),
            )}
          </section>
          <div className="left-footer">
            <ShieldCheck size={16} />
            <span>
              Your sketches stay in your browser until
              <br />
              you send them to your AI provider.
            </span>
            <button className="text-button" onClick={() => setHelp(true)}>
              How it works <ArrowRight size={12} />
            </button>
          </div>
        </aside>
        <section className="drawing-workspace" aria-label="Drawing workspace">
          <div className="canvas-toolbar">
            <div className="canvas-tabs">
              <button
                className={tab === "drawing" ? "active" : ""}
                onClick={() => setTab("drawing")}
              >
                <Layers2 size={14} /> Drawing
              </button>
              <button
                className={tab === "code" ? "active" : ""}
                onClick={() => setTab("code")}
              >
                <Code2 size={15} /> Code
              </button>
            </div>
            <div className="canvas-tools">
              <button
                className={`icon-button ${mode === "select" ? "active" : ""}`}
                aria-label="Select tool"
                title="Select (V)"
                onClick={() => setMode("select")}
              >
                <MousePointer2 size={17} />
              </button>
              <button
                className={`icon-button ${mode === "pan" ? "active" : ""}`}
                aria-label="Pan tool"
                title="Pan (H)"
                onClick={() => setMode("pan")}
              >
                <Hand size={17} />
              </button>
              <span className="tool-separator" />
              <button
                className="icon-button"
                aria-label="Undo"
                title="Undo (Ctrl Z)"
                disabled={history.index === 0 || busy}
                onClick={() => navigate(-1)}
              >
                <Undo2 size={17} />
              </button>
              <button
                className="icon-button"
                aria-label="Redo"
                title="Redo (Ctrl Shift Z)"
                disabled={history.index === history.items.length - 1 || busy}
                onClick={() => navigate(1)}
              >
                <Redo2 size={17} />
              </button>
              <span className="tool-separator" />
              <button
                className="icon-button"
                aria-label="Fit drawing"
                title="Fit drawing"
                onClick={() => preview.current?.send("fit")}
              >
                <Maximize size={16} />
              </button>
            </div>
          </div>
          <div className={`canvas ${tab === "code" ? "show-code" : ""}`}>
            <div className="canvas-document-heading">
              <span>{drawing.title}</span>
              <span className="document-chip">
                {drawing.summary.startsWith("Example")
                  ? "EXAMPLE DRAWING"
                  : "VECTOR DRAWING"}
              </span>
            </div>
            <div className="drawing-paper">
              <Preview
                ref={preview}
                html={previewHTML}
                onSnapshot={(snapshot) => setElements(snapshot.elements)}
                onSelection={(id) => {
                  if (id === null || elements.some((el) => el.id === id))
                    setSelectedId(id);
                }}
                onError={(text) => tell(text, true)}
                onZoom={setZoom}
                selectedId={selectedId}
                layers={layers}
                mode={mode}
              />
            </div>
            {tab === "code" && (
              <div className="code-panel">
                <div className="code-heading">
                  <span>
                    <Code2 size={16} /> Drawing source
                  </span>
                  <button
                    className="button small primary"
                    disabled={busy}
                    onClick={() => {
                      const candidate = {
                        title: drawing.title,
                        html: code,
                        summary: "Source code updated.",
                        notes: drawing.notes,
                      };
                      pendingRef.current = candidate;
                      setPending(candidate);
                      setBusy(true);
                      setTab("drawing");
                    }}
                  >
                    Apply code <Check size={13} />
                  </button>
                </div>
                <textarea
                  aria-label="Drawing source code"
                  spellCheck={false}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
                <div className="code-note">
                  <ShieldCheck size={13} /> HTML, SVG & synchronous JavaScript
                  run inside the drawing sandbox.
                </div>
              </div>
            )}
            {busy && (
              <div className="canvas-loading">
                <Loader2 className="spin" size={20} />
                <span>
                  {pending
                    ? "Checking your drawing…"
                    : "Receiving AI response…"}
                </span>
                <button onClick={cancelGeneration}>Cancel</button>
              </div>
            )}
            <div className="canvas-hint">
              <MousePointer2 size={13} />
              <span>
                {selected
                  ? `${selected.label} selected`
                  : "Click any element to refine it with AI"}
              </span>
            </div>
            <div className="zoom-controls">
              <button
                aria-label="Zoom out"
                onClick={() => preview.current?.send("zoom", -1)}
              >
                <Minus size={15} />
              </button>
              <span>{zoom}%</span>
              <button
                aria-label="Zoom in"
                onClick={() => preview.current?.send("zoom", 1)}
              >
                <Plus size={15} />
              </button>
              <span className="zoom-divider" />
              <button
                aria-label="Reset view"
                onClick={() => preview.current?.send("fit")}
              >
                <Focus size={16} />
              </button>
            </div>
          </div>
          <div className="canvas-status">
            <span>
              <span className="status-dot" /> {busy ? "AI is working" : "Ready"}
              <span className="status-divider">/</span>
              {elements.filter((e) => e.layer === "geometry").length} geometry
              elements
            </span>
            <span>
              <span className="scale-icon">↔</span> 1 unit = 1 mm{" "}
              <span className="status-divider">/</span> SVG
            </span>
          </div>
        </section>
        <aside className="assistant-panel">
          <div className="assistant-heading">
            <div className="assistant-mark">
              <Sparkles size={19} />
            </div>
            <div>
              <h2>Drawing assistant</h2>
              <p>
                <span />{" "}
                {busy
                  ? "Working on your drawing"
                  : "A little help, a lot of precision"}
              </p>
            </div>
          </div>
          <div className="assistant-content">
            <div className="assistant-intro">
              <div className="intro-art">
                <span />
                <span />
                <span />
                <Sparkles size={18} />
              </div>
              <h3>Your idea, engineered.</h3>
              <p>
                Describe a change in plain language.
                <br />
                I’ll take care of the geometry.
              </p>
            </div>
            {messages.map((message, index) => (
              <div className={`chat-message ${message.role}`} key={index}>
                {message.role === "assistant" && (
                  <div className="chat-avatar">
                    <Sparkles size={12} />
                  </div>
                )}
                <div className="message-content">
                  <span className="message-text">
                    {message.text ||
                      (message.status === "streaming"
                        ? "Connecting to your model…"
                        : message.status === "cancelled"
                          ? "Generation stopped."
                          : "")}
                  </span>
                  {message.status === "streaming" && message.text && (
                    <span className="stream-cursor" aria-hidden="true" />
                  )}
                  {message.code && (
                    <details
                      className="stream-code"
                      open={message.status === "streaming"}
                    >
                      <summary>
                        <Code2 size={12} /> Receiving drawing code ·{" "}
                        {message.received?.toLocaleString()} characters
                      </summary>
                      <pre>{message.code}</pre>
                    </details>
                  )}
                  {message.status && message.status !== "complete" && (
                    <small className={`reply-status ${message.status}`}>
                      {message.status === "streaming"
                        ? "Streaming response"
                        : message.status === "validating"
                          ? "Checking the completed drawing"
                          : message.status === "cancelled"
                            ? "Stopped"
                            : "Response incomplete — drawing unchanged"}
                    </small>
                  )}
                </div>
              </div>
            ))}
            {messages.length === 1 && (
              <div className="suggestions">
                <span>TRY ASKING</span>
                {[
                  "Make the plate 140 mm wide",
                  "Change all holes to Ø12 mm",
                  "Round the corners to R12",
                ].map((text) => (
                  <button key={text} onClick={() => setChatInput(text)}>
                    {text}
                    <ArrowLeft size={12} />
                  </button>
                ))}
              </div>
            )}
            {busy && (
              <div className="thinking">
                <span />
                <span />
                <span />{" "}
                {pending
                  ? "Validating geometry"
                  : "Receiving your model’s response"}
              </div>
            )}
            <div ref={chatEnd} />
          </div>
          {selected && (
            <div className="selection-card">
              <div className="selection-heading">
                <span>
                  <MousePointer2 size={13} /> SELECTED ELEMENT
                </span>
                <button
                  className="icon-button"
                  aria-label="Clear selection"
                  onClick={() => setSelectedId(null)}
                >
                  <X size={14} />
                </button>
              </div>
              <strong>{selected.label}</strong>
              <div className="selection-properties">
                <span>{selected.tag}</span>
                {Object.entries(selected.attributes)
                  .filter(([key]) =>
                    ["r", "cx", "cy", "width", "height", "rx"].includes(key),
                  )
                  .slice(0, 3)
                  .map(([key, value]) => (
                    <span key={key}>
                      {key}: {value} mm
                    </span>
                  ))}
              </div>
              <p>Changes apply to this element and its dimensions.</p>
            </div>
          )}
          {clarification && (
            <div className="clarification-banner">
              <CircleHelp size={15} /> A measurement is needed. Reply below to
              continue.
            </div>
          )}
          <div className="chat-composer">
            <div className="composer-input">
              <textarea
                aria-label="Ask AI to edit drawing"
                rows={3}
                value={chatInput}
                disabled={busy}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendChat();
                  }
                }}
                placeholder={
                  clarification
                    ? "Add the missing dimensions…"
                    : selected
                      ? `How should I change ${selected.label.toLowerCase()}?`
                      : "Describe a change to your drawing…"
                }
              />
              <div className="composer-bottom">
                <span>
                  {selected ? (
                    <>
                      <MousePointer2 size={11} /> Selected element
                    </>
                  ) : (
                    <>
                      <Layers2 size={11} /> Whole drawing
                    </>
                  )}
                </span>
                <button
                  aria-label={
                    busy ? "Stop generation" : "Send drawing instruction"
                  }
                  disabled={!busy && !chatInput.trim()}
                  onClick={busy ? cancelGeneration : sendChat}
                >
                  {busy ? (
                    <Square size={13} fill="currentColor" />
                  ) : (
                    <Send size={15} />
                  )}
                </button>
              </div>
            </div>
            <div className="assistant-model">
              <span
                className={`connection-dot ${config.apiKey && config.model ? "connected" : ""}`}
              />
              <button onClick={() => setSettings(true)}>
                {config.apiKey && config.model
                  ? config.model
                  : "Connect your AI model"}
                <ChevronDown size={11} />
              </button>
              <span>↵ to send</span>
            </div>
          </div>
        </aside>
      </main>
      {pending && (
        <div className="validation-preview" aria-hidden="true">
          <Preview
            title="Drawing validation sandbox"
            html={pending.html}
            onSnapshot={onSnapshot}
            onSelection={() => {}}
            onError={onPreviewError}
            onZoom={() => {}}
            selectedId={null}
            layers={{ geometry: true, dimensions: true, presentation: true }}
            mode="select"
          />
        </div>
      )}
      {notice && (
        <div
          className={`toast ${notice.error ? "error" : ""}`}
          role={notice.error ? "alert" : "status"}
        >
          {notice.error ? <CircleHelp size={17} /> : <Check size={17} />}
          <span>{notice.text}</span>
          <button
            aria-label="Dismiss notification"
            onClick={() => setNotice(null)}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {settings && (
        <ModelSettings
          config={config}
          onClose={() => setSettings(false)}
          onSave={(next) => {
            setConfig(next);
            setSettings(false);
            try {
              localStorage.setItem(
                "draftline-model",
                JSON.stringify({ baseURL: next.baseURL, model: next.model }),
              );
            } catch {
              /* Settings remain in memory. */
            }
            tell("Model settings saved for this session.");
          }}
        />
      )}
      {help && (
        <div className="help-backdrop" onClick={() => setHelp(false)}>
          <div
            className="help-card"
            role="dialog"
            aria-modal="true"
            aria-label="How Draftline works"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="icon-button help-close"
              aria-label="Close help"
              onClick={() => setHelp(false)}
            >
              <X size={18} />
            </button>
            <div className="dialog-icon">
              <Sparkles size={22} />
            </div>
            <h2>From sketch to SVG.</h2>
            <p>
              1. Connect an OpenAI-compatible vision model in Model settings.
            </p>
            <p>
              2. Upload, drop, or paste a sketch. Add essential dimensions, then
              generate. The assistant asks about missing measurements.
            </p>
            <p>
              3. Click a shape and describe your change. Clear selection to edit
              the whole drawing. Use the hand tool to pan, and scroll to zoom.
            </p>
            <p>
              4. Export geometry or a dimensioned SVG. The SVG preserves
              millimeter scale, with page margins for annotations.
            </p>
            <small>
              Drawings are saved locally. Sketches and keys are kept in memory.
              Sending a request shares its sketch and drawing with your selected
              provider.
            </small>
            <button className="button primary" onClick={() => setHelp(false)}>
              Let’s draw <ArrowRight size={15} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

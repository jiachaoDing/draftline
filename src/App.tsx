import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  Check,
  ChevronDown,
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
import ProjectList from "./components/ProjectList";
import ChatTranscript from "./components/ChatTranscript";
import RequestUserInput from "./components/RequestUserInput";
import type { UserInputResponse } from "./lib/user-input";
import {
  pendingQuestions,
  questionArgs,
  questionText,
  answerQuestions,
} from "./lib/user-input-flow";
import SketchUpload, { type Sketch } from "./components/SketchUpload";
import { Preview, type PreviewHandle } from "./components/Preview";
import {
  downloadFile,
  exportSVG,
  presentationSVG,
  svgToHTML,
} from "./lib/drawing";
import { pushHistory, type History } from "./lib/history";
import { requestDrawing } from "./lib/api";
import { runDrawingAgent } from "./lib/drawing-agent";
import { validateDrawingSource } from "./lib/validate-source";
import { previewStream } from "./lib/stream-preview";
import { useDrawingSource } from "./hooks/useDrawingSource";
import {
  drawingContext,
  drawingChange,
  drawingRevision,
  type DrawingContext,
} from "./lib/ai-workflow";
import {
  newProject,
  loadProjects,
  saveProject,
  selectProject,
  deleteProject,
  welcome,
  type Project,
} from "./lib/projects";
import { readConfig, defaultConfig } from "./lib/model-settings";
import type {
  ChatMessage,
  Drawing,
  ElementInfo,
  Snapshot,
  PendingUserInput,
} from "./lib/contracts";

const CodeEditor = lazy(() => import("./components/CodeEditor"));

export default function App() {
  const [config, setConfig] = useState(readConfig);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeId, setActiveId] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState("Opening workspace…");
  const [projectBusy, setProjectBusy] = useState(false);
  // Event/effect writes own these refs. A concurrent render may still contain
  // older React state, so it must not overwrite an in-flight workspace update.
  const projectsRef = useRef(projects);
  const activeProject = projects.find((project) => project.id === activeId);
  const activeIdRef = useRef(activeId);
  const [settings, setSettings] = useState(false);
  const [history, setHistory] = useState<History<Drawing | null>>(() => ({
    items: [null],
    index: 0,
  }));
  const drawing = history.items[history.index];
  const [pending, setPending] = useState<Omit<Drawing, "svg"> | null>(null);
  const pendingRef = useRef(pending);
  const [sketch, setSketch] = useState<Sketch | null>(null);
  const [elements, setElements] = useState<ElementInfo[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = elements.find((el) => el.id === selectedId);
  const [layers, setLayers] = useState({
    geometry: true,
    dimensions: true,
    presentation: true,
  });
  const previewHTML = useMemo(
    () => (drawing ? svgToHTML(presentationSVG(drawing.svg, drawing)) : ""),
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
  const [clarification, setClarification] = useState<DrawingContext | null>(
    null,
  );
  const [userInput, setUserInput] = useState<PendingUserInput | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [tab, setTab] = useState<"drawing" | "code">("drawing");
  const [help, setHelp] = useState(false);
  const preview = useRef<PreviewHandle>(null);
  const abort = useRef<AbortController | null>(null);
  const activeReply = useRef<string | null>(null);
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
  const { code, setCode, formattingCode, formatCode } = useDrawingSource(
    drawing,
    tell,
  );

  const openProject = useCallback((project: Project) => {
    activeIdRef.current = project.id;
    setActiveId(project.id);
    setHistory(project.history);
    setMessages(project.messages);
    setSketch(project.sketch);
    setChatInput(project.chatInput);
    setClarification(project.clarification);
    setUserInput(project.userInput);
    setLayers(project.layers);
    setSelectedId(null);
    setElements([]);
    setMode("select");
    setZoom(100);
    setTab("drawing");
    setExportOpen(false);
    setNotice(null);
  }, []);
  const saveSequence = useRef(0);
  const streamSaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const persist = useCallback(
    async (project: Project) => {
      const sequence = ++saveSequence.current;
      setSaveStatus("Saving locally…");
      try {
        await saveProject(project);
        if (sequence === saveSequence.current) setSaveStatus("Saved locally");
      } catch {
        if (sequence === saveSequence.current) setSaveStatus("Not saved");
        tell(
          "Browser storage is unavailable or full. Export your drawing to keep it, then free storage and reload.",
          true,
        );
      }
    },
    [tell],
  );
  useEffect(() => {
    let mounted = true;
    loadProjects()
      .then(({ projects, activeId, invalid }) => {
        if (!mounted) return;
        const available = projects.length ? projects : [newProject()];
        projectsRef.current = available;
        setProjects(available);
        openProject(available.find((p) => p.id === activeId) || available[0]);
        setLoaded(true);
        if (invalid)
          tell(
            "Some saved projects could not be opened. Their stored data has been kept.",
            true,
          );
      })
      .catch(() => {
        if (!mounted) return;
        const project = newProject();
        projectsRef.current = [project];
        setProjects([project]);
        openProject(project);
        setLoaded(true);
        tell(
          "Browser storage is unavailable. Export drawings to keep your work.",
          true,
        );
      });
    return () => {
      mounted = false;
    };
  }, [openProject, tell]);
  useEffect(() => {
    if (!loaded) return;
    const current = projectsRef.current.find((p) => p.id === activeId);
    if (!current) return;
    const project: Project = {
      ...current,
      history,
      messages,
      sketch,
      chatInput,
      clarification: clarification
        ? { ...clarification, toolTurns: clarification.toolTurns || [] }
        : null,
      userInput,
      layers,
      name: current.renamed ? current.name : drawing?.title || current.name,
      updatedAt: Date.now(),
    };
    const next = projectsRef.current.map((p) =>
      p.id === activeId ? project : p,
    );
    projectsRef.current = next;
    setProjects(next);
    if (
      messages.at(-1)?.status === "streaming" &&
      current.messages.at(-1)?.id === messages.at(-1)?.id
    ) {
      // Batch streamed deltas so large reference images are not cloned every frame.
      if (streamSaveTimer.current === undefined) {
        streamSaveTimer.current = setTimeout(() => {
          streamSaveTimer.current = undefined;
          const latest = projectsRef.current.find((p) => p.id === activeId);
          if (latest) void persist(latest);
        }, 400);
      }
    } else {
      clearTimeout(streamSaveTimer.current);
      streamSaveTimer.current = undefined;
      void persist(project);
    }
  }, [
    loaded,
    activeId,
    history,
    messages,
    sketch,
    chatInput,
    clarification,
    userInput,
    layers,
    drawing,
    persist,
  ]);

  useEffect(() => {
    if (!loaded) return;
    const flush = () => {
      clearTimeout(streamSaveTimer.current);
      streamSaveTimer.current = undefined;
      const project = projectsRef.current.find(
        (p) => p.id === activeIdRef.current,
      );
      if (project) void persist(project);
    };
    const hide = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", hide);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", hide);
    };
  }, [loaded, persist]);

  async function changeProject(id?: string) {
    if (busy || projectBusy || !loaded || id === activeId) return;
    setProjectBusy(true);
    const current = projectsRef.current.find((p) => p.id === activeId);
    if (current) await persist(current);
    const project = id
      ? projectsRef.current.find((p) => p.id === id)
      : newProject();
    if (project) {
      if (!id) {
        const next = [project, ...projectsRef.current];
        projectsRef.current = next;
        setProjects(next);
      }
      openProject(project);
      try {
        await selectProject(project.id);
      } catch {
        setSaveStatus("Not saved");
      }
    }
    setProjectBusy(false);
  }
  async function removeProject(id: string) {
    if (busy || projectBusy) return false;
    setProjectBusy(true);
    try {
      await deleteProject(id);
      const remaining = projectsRef.current.filter((p) => p.id !== id);
      if (!remaining.length) remaining.push(newProject());
      projectsRef.current = remaining;
      setProjects(remaining);
      if (activeId === id) {
        openProject(remaining[0]);
        await persist(remaining[0]);
        await selectProject(remaining[0].id);
      }
      return true;
    } catch {
      tell(
        "The project could not be deleted from browser storage. Please try again.",
        true,
      );
      return false;
    } finally {
      setProjectBusy(false);
    }
  }
  function renameProject(id: string, projectName: string) {
    const name = projectName.trim().slice(0, 120);
    if (!name) return;
    const next = projectsRef.current.map((p) =>
      p.id === id ? { ...p, name, renamed: true, updatedAt: Date.now() } : p,
    );
    projectsRef.current = next;
    setProjects(next);
    void persist(next.find((p) => p.id === id)!);
  }

  const commit = useCallback((next: Drawing) => {
    setHistory((h) =>
      pushHistory(h, { ...next, revision: crypto.randomUUID() }),
    );
    setSelectedId(null);
    setElements([]);
    setClarification(null);
    setTab("drawing");
    setUserInput(null);
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
  useEffect(
    () => () => {
      abort.current?.abort();
      clearTimeout(streamSaveTimer.current);
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
      const projectId = activeIdRef.current;
      reader.onload = () => {
        if (activeIdRef.current !== projectId) return;
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
      if (busy || settings || userInput) return;
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
  }, [loadFile, busy, settings, userInput]);
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (
        (event.target as HTMLElement).closest(
          "input,textarea,dialog,[contenteditable]",
        ) ||
        busy ||
        userInput ||
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
  }, [busy, pending, userInput]);

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

  async function runAI(input: DrawingContext) {
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
      const projectId = activeIdRef.current;
      const baseRevision = drawing ? drawingRevision(drawing) : undefined;
      const outcome = await runDrawingAgent({
        context: input,
        config,
        drawing,
        signal: controller.signal,
        request: requestDrawing,
        validate: validateDrawingSource,
        isCurrent: () => {
          const project = projectsRef.current.find((p) => p.id === projectId);
          const current = project?.history.items[project.history.index];
          return (
            activeIdRef.current === projectId &&
            (current ? drawingRevision(current) : undefined) === baseRevision
          );
        },
        onRound: () => {
          source = "";
        },
        onTool: (name) => {
          setMessages((messages) =>
            messages.map((message) =>
              message.id === replyId
                ? {
                    ...message,
                    text:
                      name === "apply_patch"
                        ? "Applying and validating drawing patch…"
                        : "Inspecting drawing source…",
                  }
                : message,
            ),
          );
        },
        onDelta: (text) => {
          source += text;
          if (updateFrame === undefined)
            updateFrame = requestAnimationFrame(() => flush());
        },
      });
      const { result } = outcome;
      if (updateFrame !== undefined) cancelAnimationFrame(updateFrame);
      flush();
      controller.signal.throwIfAborted();
      if (outcome.drawing) {
        commit(outcome.drawing);
        finishReply(
          "complete",
          result.kind === "message" ? result.message : outcome.drawing.summary,
        );
        tell("Drawing updated.");
      } else if (result.kind === "request_user_input") {
        setUserInput(pendingQuestions(outcome.context, result));
        finishReply("complete", questionText(result));
      } else if (result.kind === "message") {
        setUserInput(null);
        finishReply("complete", result.message);
      } else if (result.kind === "clarification") {
        setUserInput(null);
        setClarification(input);
        finishReply("complete", result.question);
      } else if (result.kind !== "tool_calls") {
        const change = drawingChange(result, input, drawing);
        if (change.kind === "commit") {
          commit(change.drawing);
          finishReply("complete", result.summary);
          tell("Selected element updated.");
        } else {
          finishReply("validating", result.summary);
          pendingRef.current = change.candidate;
          setPending(change.candidate);
          setTab("drawing");
          setSelectedId(null);
        }
      }
    } catch (error) {
      if (updateFrame !== undefined) cancelAnimationFrame(updateFrame);
      flush(true);
      if (clarification) setClarification(input);
      if (userInput) setUserInput(userInput);
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

  const submitUserInput = (response: UserInputResponse) => {
    if (!userInput || busy || projectBusy) return;
    if (!config.apiKey || !config.model) {
      setSettings(true);
      return;
    }
    try {
      const answer = answerQuestions(userInput, response);
      if (answer.kind === "next") {
        setUserInput(answer.pending);
        return;
      }
      setMessages((messages) => [
        ...messages.filter((message) => message.id !== answer.message.id),
        answer.message,
      ]);
      void runAI(answer.context);
    } catch (error) {
      tell((error as Error).message, true);
    }
  };
  const cancelUserInput = () => {
    setUserInput(null);
    setMessages((messages) => [
      ...messages,
      { role: "assistant", text: "Questions cancelled.", status: "cancelled" },
    ]);
  };

  const sendChat = () => {
    const text =
      chatInput.trim() ||
      (sketch
        ? "Use this reference sketch to create or refine the drawing. Read its dimensions and ask for anything essential that is unclear."
        : "");
    if (!text || busy || projectBusy || !loaded || userInput) return;
    if (!config.apiKey || !config.model) {
      setSettings(true);
      return;
    }
    setChatInput("");
    const previousReference = [...messages]
      .reverse()
      .find((m) => m.reference)?.reference;
    const reference =
      sketch &&
      (sketch.data !== previousReference?.data ||
        sketch.name !== previousReference?.name)
        ? sketch
        : undefined;
    setMessages((m) => [...m, { role: "user", text, reference }]);
    void runAI(
      drawingContext(
        text,
        messages,
        drawing,
        sketch?.data,
        selectedId || undefined,
        clarification,
      ),
    );
  };
  const useExample = async () => {
    const projectId = activeIdRef.current;
    const draft = chatInput;
    try {
      const image = new Image();
      image.src = "/example-sketch.svg";
      await image.decode();
      if (activeIdRef.current !== projectId) return;
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      canvas.getContext("2d")!.drawImage(image, 0, 0);
      setSketch({
        name: "mounting-plate-sketch.png",
        data: canvas.toDataURL("image/png"),
      });
      setChatInput((current) =>
        current === draft
          ? "120 × 80 mm plate, R8 corners. Four Ø10 holes; centers 20 mm from each edge."
          : current,
      );
      tell(
        "Example sketch loaded. Connect your model and generate your own drawing.",
      );
    } catch {
      tell("The example image could not be loaded.", true);
    }
  };
  const exportDrawing = (annotations: boolean) => {
    if (!drawing) return;
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

  if (!loaded)
    return (
      <div className="workspace-opening" role="status">
        <Loader2 className="spin" size={24} /> Opening your workspace…
      </div>
    );

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
          <span className="project-title" title={activeProject?.name}>
            {activeProject?.name}
          </span>{" "}
          <span className="beta">BETA</span>
        </div>
        <div className="header-actions">
          <span className="saved-indicator">
            <span /> {saveStatus}
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
              disabled={busy || !drawing}
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
            <h1>Room for every idea.</h1>
            <p>Your drawings, right where you left them.</p>
          </div>
          <ProjectList
            key={activeId}
            projects={projects}
            activeId={activeId}
            disabled={busy || projectBusy}
            projectBusy={projectBusy}
            onOpen={(id) => void changeProject(id)}
            onRename={renameProject}
            onDelete={removeProject}
          />
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
                disabled={history.index === 0 || busy || !!userInput}
                onClick={() => navigate(-1)}
              >
                <Undo2 size={17} />
              </button>
              <button
                className="icon-button"
                aria-label="Redo"
                title="Redo (Ctrl Shift Z)"
                disabled={
                  history.index === history.items.length - 1 ||
                  busy ||
                  !!userInput
                }
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
              <span>{drawing?.title || activeProject?.name}</span>
              <span className="document-chip">
                {!drawing
                  ? "NEW DRAWING"
                  : drawing.summary.startsWith("Example")
                    ? "EXAMPLE DRAWING"
                    : "VECTOR DRAWING"}
              </span>
            </div>
            <div className="drawing-paper">
              {drawing ? (
                <Preview
                  key={activeId}
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
              ) : (
                <div className="empty-canvas">
                  <div className="assistant-mark">
                    <Sparkles size={24} />
                  </div>
                  <h2>A fresh page for your next idea.</h2>
                  <p>
                    Describe your part or attach a sketch
                    <br />
                    in the drawing assistant to get started.
                  </p>
                  <span>Precise vectors · millimeter scale</span>
                </div>
              )}
            </div>
            {tab === "code" && (
              <div className="code-panel">
                <div className="code-heading">
                  <span>
                    <Code2 size={16} /> Drawing source
                  </span>
                  <div className="code-actions">
                    <button
                      className="button small"
                      disabled={busy || formattingCode || !!userInput}
                      onClick={formatCode}
                    >
                      {formattingCode ? "Formatting…" : "Format"}
                    </button>
                    <button
                      className="button small primary"
                      disabled={busy || formattingCode || !!userInput}
                      onClick={() => {
                        const candidate = {
                          title:
                            drawing?.title ||
                            activeProject?.name ||
                            "Untitled drawing",
                          html: code,
                          summary: "Source code updated.",
                          notes: drawing?.notes,
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
                </div>
                <Suspense
                  fallback={
                    <div className="code-editor" role="status">
                      Loading editor…
                    </div>
                  }
                >
                  <CodeEditor
                    value={code}
                    onChange={setCode}
                    disabled={busy || formattingCode || !!userInput}
                  />
                </Suspense>
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
                  : drawing
                    ? "Click any element to refine it with AI"
                    : "Your drawing starts in the assistant"}
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
          <ChatTranscript
            messages={messages}
            hasDrawing={!!drawing}
            busy={busy}
            validating={!!pending}
            onSuggest={setChatInput}
          />
          {selected && !userInput && (
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
          {userInput && !busy ? (
            <RequestUserInput
              key={`${activeId}:${userInput.request.calls[userInput.callIndex].id}`}
              args={questionArgs(userInput.request, userInput.callIndex)}
              state={userInput.state}
              disabled={busy || projectBusy}
              onChange={(state) => setUserInput({ ...userInput, state })}
              onSubmit={submitUserInput}
              onCancel={cancelUserInput}
            />
          ) : (
            <>
              {clarification && (
                <div className="clarification-banner">
                  <CircleHelp size={15} /> A measurement is needed. Reply below
                  to continue.
                </div>
              )}
              <div className="chat-composer">
                <SketchUpload
                  sketch={sketch}
                  onFile={loadFile}
                  onClear={() => {
                    setSketch(null);
                    setClarification(null);
                  }}
                  disabled={busy || projectBusy}
                />
                {messages.length === 1 && (
                  <button
                    className="example-button"
                    onClick={useExample}
                    disabled={busy || projectBusy}
                  >
                    Try an example <ArrowRight size={12} />
                  </button>
                )}
                <div className="composer-input">
                  <textarea
                    aria-label="Drawing instructions"
                    rows={3}
                    value={chatInput}
                    disabled={busy || projectBusy}
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
                          : drawing
                            ? "Describe a change to your drawing…"
                            : "Describe your part and dimensions in mm…"
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
                          <Layers2 size={11} />{" "}
                          {drawing ? "Whole drawing" : "New drawing"}
                        </>
                      )}
                    </span>
                    <button
                      aria-label={
                        busy ? "Stop generation" : "Send drawing instruction"
                      }
                      disabled={
                        projectBusy || (!busy && !chatInput.trim() && !sketch)
                      }
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
            </>
          )}
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
          onClear={() => {
            try {
              localStorage.removeItem("draftline-model");
              setConfig({ ...defaultConfig });
              setSettings(false);
              tell("Saved model settings cleared.");
            } catch {
              tell(
                "Saved settings could not be cleared. Please check browser storage access.",
                true,
              );
            }
          }}
          onSave={(next) => {
            setConfig(next);
            setSettings(false);
            try {
              localStorage.setItem("draftline-model", JSON.stringify(next));
            } catch {
              tell(
                "Settings work for this session, but browser storage could not save them.",
                true,
              );
              return;
            }
            tell("Model settings saved in this browser.");
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
              2. Start a New Drawing. Attach or paste a sketch in the assistant,
              add essential dimensions, and send. Reply there to clarify
              measurements.
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
              Projects, conversations, sketches and model settings are saved in
              this browser. Sending a request shares its sketch and drawing with
              your selected provider.
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

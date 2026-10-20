import { currentLocale, t, useLocale } from "./lib/i18n";
import { useProjectField } from "./hooks/useProjectField";
import { useProjectSession } from "./hooks/useProjectSession";
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
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Redo2,
  Settings2,
  ShieldCheck,
  Sparkles,
  Undo2,
  X,
} from "lucide-react";
import ModelSettings from "./components/ModelSettings";
import LanguageSelect from "./components/LanguageSelect";
import SelectionPanel from "./components/SelectionPanel";
import ObjectTree from "./components/ObjectTree";
import ReviewChanges from "./components/ReviewChanges";
import {
  groupObjects,
  ungroupObjects,
  normalizeSelection,
} from "./lib/svg-selection";
import { reviewDrawing } from "./lib/drawing-review";
import { EMPTY_SELECTION, type SelectionState } from "./lib/contracts";
import DrawingSidebar from "./components/DrawingSidebar";
import DrawingLayers from "./components/DrawingLayers";
import ChatTranscript from "./components/ChatTranscript";
import ConversationHistory from "./components/ConversationHistory";
import AssistantChat, {
  type AssistantChatHandle,
} from "./components/AssistantChat";
import ChatComposer from "./components/ChatComposer";
import type { ChatAttachment } from "./lib/contracts";
import RequestUserInput from "./components/RequestUserInput";
import type { UserInputResponse } from "./lib/user-input";
import {
  pendingQuestions,
  questionArgs,
  questionText,
  answerQuestions,
} from "./lib/user-input-flow";
import { Preview, type PreviewHandle } from "./components/Preview";
import {
  downloadFile,
  exportSVG,
  presentationSVG,
  svgToHTML,
  listElements,
  sanitizeSVG,
} from "./lib/drawing";
import { pushHistory } from "./lib/history";
import {
  recordConversation,
  conversationPath,
  restoreConversation,
  sameCanvas,
} from "./lib/conversation";
import { requestDrawing } from "./lib/api";
import {
  runDrawingAgent,
  DrawingAgentRecoveryError,
  type DrawingAgentCheckpoint,
} from "./lib/drawing-agent";
import { projectResources } from "./lib/resources";
import { validateDrawingSource } from "./lib/validate-source";
import {
  settleActivities,
  updateActivity,
  activityLabel,
  type ActivityHandler,
} from "./lib/agent-activity";
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
import type { ChatMessage, Drawing, ElementInfo } from "./lib/contracts";

const CodeEditor = lazy(() => import("./components/CodeEditor"));

export default function App() {
  useLocale();
  const [config, setConfig] = useState(readConfig);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeId, setActiveId] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [projectBusy, setProjectBusy] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(
    () => !window.matchMedia("(max-width: 700px)").matches,
  );
  // Event/effect writes own these refs. A concurrent render may still contain
  // older React state, so it must not overwrite an in-flight workspace update.
  const projectsRef = useRef(projects);
  const activeProject = projects.find((project) => project.id === activeId);
  const activeIdRef = useRef(activeId);
  const [settings, setSettings] = useState(false);
  const updateProject = useCallback(
    (id: string, update: (p: Project) => Project) => {
      const next = projectsRef.current.map((p) => {
        if (p.id !== id) return p;
        let changed = update(p);
        if (changed.messages !== p.messages) {
          const conversation = recordConversation(
            changed.messages,
            changed.conversation,
          );
          changed = {
            ...changed,
            conversation,
            messages: conversationPath(conversation),
          };
        }
        const current = changed.history.items[changed.history.index];
        return {
          ...changed,
          name: changed.renamed ? changed.name : current?.title || changed.name,
          updatedAt: Date.now(),
        };
      });
      projectsRef.current = next;
      setProjects(next);
    },
    [],
  );
  const [history, setHistory] = useProjectField(
    activeProject,
    "history",
    {
      items: [null],
      index: 0,
    },
    updateProject,
  );
  const drawing = history.items[history.index];
  const {
    busy,
    setBusy,
    pending,
    setPending,
    review,
    setReview,
    abort,
    reply: activeReply,
    editContext,
    sessions,
  } = useProjectSession(activeId);
  const [elements, setElements] = useState<ElementInfo[]>([]);
  const [selection, setSelection] = useState<SelectionState>(EMPTY_SELECTION);
  const selectedId = selection.ids[0] || null;
  const selected = elements.find((el) => el.id === selectedId);
  const [layers, setLayers] = useProjectField(
    activeProject,
    "layers",
    {
      geometry: true,
      dimensions: true,
      presentation: true,
    },
    updateProject,
  );
  const previewHTML = useMemo(() => {
    const shown = review?.drawing || drawing;
    return shown ? svgToHTML(presentationSVG(shown.svg, shown)) : "";
  }, [drawing, review]);
  const [mode, setMode] = useState<"select" | "pan">("select");
  const [zoom, setZoom] = useState(100);
  const [messages, setMessages] = useProjectField(
    activeProject,
    "messages",
    [welcome],
    updateProject,
  );
  const [chatInput, setChatInput] = useProjectField(
    activeProject,
    "chatInput",
    "",
    updateProject,
  );
  const [attachments, setAttachments] = useProjectField(
    activeProject,
    "attachments",
    [],
    updateProject,
  );
  const runningActivity = [...(messages.at(-1)?.activities || [])]
    .reverse()
    .find((activity) => activity.status === "running");
  const [notice, setNotice] = useState<{
    text: string;
    error?: boolean;
  } | null>(null);
  const [clarification, setClarification] = useProjectField(
    activeProject,
    "clarification",
    null,
    updateProject,
  );
  const [userInput, setUserInput] = useProjectField(
    activeProject,
    "userInput",
    null,
    updateProject,
  );
  const [exportOpen, setExportOpen] = useState(false);
  const [tab, setTab] = useState<"drawing" | "code">("drawing");
  const [objectsOpen, setObjectsOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const preview = useRef<PreviewHandle>(null);
  const composer = useRef<AssistantChatHandle>(null);
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
    setSelection(EMPTY_SELECTION);
    setElements([]);
    setMode("select");
    setZoom(100);
    setTab("drawing");
    setExportOpen(false);
    setNotice(null);
  }, []);
  const persist = useCallback(
    async (project: Project) => {
      try {
        await saveProject(project);
      } catch {
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
        const available = projects.length
          ? projects
          : [newProject(null, [], t("Untitled drawing"))];
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
        const project = newProject(null, [], t("Untitled drawing"));
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
  const savedProjects = useRef(new Map<string, Project>());
  const saveTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    if (!loaded) return;
    for (const project of projects) {
      if (savedProjects.current.get(project.id) === project) continue;
      savedProjects.current.set(project.id, project);
      const timers = saveTimers.current;
      const save = () => {
        timers.delete(project.id);
        const latest = projectsRef.current.find((p) => p.id === project.id);
        if (latest) void persist(latest);
      };
      if (project.messages.at(-1)?.status === "streaming") {
        if (!timers.has(project.id))
          timers.set(project.id, setTimeout(save, 400));
      } else {
        clearTimeout(timers.get(project.id));
        save();
      }
    }
  }, [loaded, projects, persist]);
  useEffect(() => {
    const flush = () => {
      for (const timer of saveTimers.current.values()) clearTimeout(timer);
      saveTimers.current.clear();
      for (const project of projectsRef.current) void persist(project);
    };
    const hide = () => {
      if (document.visibilityState === "hidden") flush();
    };
    const unload = () => {
      for (const session of sessions.values()) session.abort.current?.abort();
      flush();
    };
    window.addEventListener("pagehide", unload);
    document.addEventListener("visibilitychange", hide);
    return () => {
      window.removeEventListener("pagehide", unload);
      document.removeEventListener("visibilitychange", hide);
    };
  }, [persist, sessions]);
  async function changeProject(id?: string) {
    if (projectBusy || !loaded || id === activeId) return;
    setProjectBusy(true);
    const current = projectsRef.current.find((p) => p.id === activeId);
    if (current) await persist(current);
    const project = id
      ? projectsRef.current.find((p) => p.id === id)
      : newProject(
          null,
          projectsRef.current.map((project) => project.name),
          t("Untitled drawing"),
        );
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
        tell(
          "Browser storage is unavailable. Export drawings to keep your work.",
          true,
        );
      }
    }
    setProjectBusy(false);
  }
  async function removeProject(id: string) {
    if (projectBusy) return false;
    if (sessions.get(id)?.busy || sessions.get(id)?.review) {
      tell(
        "Stop this drawing's task or resolve its proposal before deleting it.",
        true,
      );
      return false;
    }
    setProjectBusy(true);
    try {
      await deleteProject(id);
      clearTimeout(saveTimers.current.get(id));
      saveTimers.current.delete(id);
      savedProjects.current.delete(id);
      sessions.delete(id);
      const remaining = projectsRef.current.filter((p) => p.id !== id);
      if (!remaining.length)
        remaining.push(newProject(null, [], t("Untitled drawing")));
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

  const commit = useCallback(
    (next: Drawing) => {
      next = { ...next, revision: crypto.randomUUID() };
      setHistory((h) => pushHistory(h, next));
      if (activeReply.current)
        setMessages((messages) =>
          messages.map((message) =>
            message.id === activeReply.current
              ? {
                  ...message,
                  canvas: next,
                  recovery: undefined,
                  userInput: null,
                  clarification: null,
                }
              : message,
          ),
        );
      if (activeIdRef.current === activeProject?.id) {
        setSelection(EMPTY_SELECTION);
        setElements(listElements(sanitizeSVG(next.svg)));
      }
      setClarification(null);
      setUserInput(null);
      setReview(null);
      editContext.current = null;
    },
    [
      setHistory,
      setClarification,
      setUserInput,
      setReview,
      editContext,
      activeProject?.id,
      activeReply,
      setMessages,
    ],
  );
  const offerDrawing = useCallback(
    (next: Drawing) => {
      const context = editContext.current;
      if (context?.drawing && context.ids.length) {
        const changes = reviewDrawing(context.drawing, next, context.ids);
        if (changes.outsideIds.length || changes.metadata.length) {
          setReview({ drawing: next, changes });
          setMessages((messages) =>
            messages.map((message) =>
              message.id === activeReply.current
                ? { ...message, proposal: next }
                : message,
            ),
          );
          if (activeIdRef.current === activeProject?.id) setTab("drawing");
          return false;
        }
      }
      commit(next);
      return true;
    },
    [
      commit,
      editContext,
      setReview,
      activeProject?.id,
      setMessages,
      activeReply,
    ],
  );
  function changeGrouping(action: "group" | "ungroup") {
    if (!drawing || busy || review || userInput || projectBusy) return;
    try {
      const result =
        action === "group"
          ? groupObjects(drawing.svg, selection.ids, t("Group"))
          : ungroupObjects(drawing.svg, selection.ids);
      commit({
        ...drawing,
        svg: result.svg,
        html: svgToHTML(result.svg),
        summary: t(
          action === "group" ? "Objects grouped." : "Objects ungrouped.",
        ),
      });
      setSelection({
        ids: result.ids,
        rootId:
          selection.rootId && result.ids.includes(selection.rootId)
            ? null
            : selection.rootId,
      });
    } catch (error) {
      tell((error as Error).message, true);
    }
  }
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
                  resumable:
                    status === "complete" ||
                    (status === "cancelled" && !keepCode)
                      ? false
                      : message.resumable,
                  text: text ?? message.text,
                  code: keepCode ? message.code : undefined,
                  recovery:
                    status === "complete" ||
                    (status === "cancelled" && !keepCode)
                      ? undefined
                      : message.recovery,
                  proposal:
                    status === "complete" || status === "cancelled"
                      ? undefined
                      : message.proposal,
                  activities:
                    status === "error" || status === "cancelled"
                      ? settleActivities(
                          message.activities,
                          status === "error" ? "failed" : "cancelled",
                        )
                      : message.activities,
                }
              : message,
          ),
        );
      if (status !== "validating" && status !== "reviewing")
        activeReply.current = null;
    },
    [activeReply, setMessages],
  );
  const cancelGeneration = () => {
    abort.current?.abort(
      new DOMException("Generation stopped by user.", "AbortError"),
    );
  };
  useEffect(() => {
    const message = activeProject?.messages.at(-1);
    if (
      busy ||
      review ||
      message?.status !== "reviewing" ||
      !message.proposal ||
      !message.canvas
    )
      return;
    activeReply.current = message.id || null;
    const ids = message.request?.selectedIds || [];
    editContext.current = { drawing: message.canvas, ids };
    setReview({
      drawing: message.proposal,
      changes: reviewDrawing(message.canvas, message.proposal, ids),
    });
  }, [activeProject, busy, review, activeReply, editContext, setReview]);
  useEffect(
    () => () => {
      for (const session of sessions.values()) session.abort.current?.abort();
      for (const timer of saveTimers.current.values()) clearTimeout(timer);
      clearTimeout(noticeTimer.current);
    },
    [sessions],
  );
  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!exporting.current?.contains(event.target as Node))
        setExportOpen(false);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (
        (event.target as HTMLElement).closest(
          "input,textarea,dialog,[contenteditable]",
        ) ||
        busy ||
        review ||
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
        setSelection(EMPTY_SELECTION);
      }
      if (event.key === "Escape") {
        preview.current?.send("command", "escape");
        setExportOpen(false);
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "g") {
        event.preventDefault();
        preview.current?.send("command", event.shiftKey ? "ungroup" : "group");
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
        event.preventDefault();
        preview.current?.send("command", "select-all");
      }
      if (event.key.toLowerCase() === "v") setMode("select");
      if (event.key.toLowerCase() === "h") setMode("pan");
    };
    document.addEventListener("keydown", keyboard);
    return () => document.removeEventListener("keydown", keyboard);
  }, [busy, pending, userInput, review, setHistory]);

  async function runAI(
    input: DrawingContext,
    recovery?: DrawingAgentCheckpoint,
    baseDrawing: Drawing | null = drawing,
    retryId?: string,
  ) {
    if (abort.current || review) return;
    input = { ...input, language: currentLocale() };
    editContext.current = {
      drawing: baseDrawing,
      ids: input.selectedIds || (input.selectedId ? [input.selectedId] : []),
    };
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
    const replyId = retryId || crypto.randomUUID();
    activeReply.current = replyId;
    setMessages((messages) => [
      ...messages.filter((message) => message.id !== replyId),
      {
        id: replyId,
        role: "assistant",
        text: "",
        status: "streaming",
        canvas: baseDrawing,
        request: input,
        recovery,
        userInput,
        clarification: null,
        activities: recovery
          ? settleActivities(
              messages.find((message) => message.id === replyId)?.activities,
              "cancelled",
            ).slice(-200)
          : [
              {
                id: "model:0",
                kind: "model",
                status: "pending",
                detail: "Request submitted. Connecting to your model.",
              },
            ],
      },
    ]);
    const onActivity: ActivityHandler = (activity) => {
      if (controller.signal.aborted || activeReply.current !== replyId) return;
      setMessages((messages) =>
        messages.map((message) =>
          message.id === replyId
            ? {
                ...message,
                activities: updateActivity(message.activities, activity).slice(
                  -256,
                ),
              }
            : message,
        ),
      );
    };
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
      const owner = projectsRef.current.find(
        (project) => project.id === projectId,
      );
      const baseRevision = baseDrawing
        ? drawingRevision(baseDrawing)
        : undefined;
      const outcome = await runDrawingAgent({
        projectId,
        recovery: recovery ? { ...recovery, context: input } : undefined,
        context: input,
        resources: owner
          ? projectResources({ ...owner, attachments: [] }, input.attachments)
          : input.attachments,
        config,
        drawing: baseDrawing,
        signal: controller.signal,
        request: requestDrawing,
        validate: validateDrawingSource,
        isCurrent: () => {
          const project = projectsRef.current.find((p) => p.id === projectId);
          const current = project?.history.items[project.history.index];
          return (
            !!project &&
            (current ? drawingRevision(current) : undefined) === baseRevision
          );
        },
        onRound: () => {
          source = "";
        },
        onActivity,
        onCheckpoint: async (checkpoint) => {
          controller.signal.throwIfAborted();
          setMessages((messages) =>
            messages.map((message) =>
              message.id === replyId
                ? { ...message, recovery: checkpoint, resumable: true }
                : message,
            ),
          );
          const project = projectsRef.current.find(
            (project) => project.id === projectId,
          );
          if (project) await persist(project);
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
        const committed = offerDrawing(outcome.drawing);
        finishReply(
          committed ? "complete" : "reviewing",
          result.kind === "message" ? result.message : outcome.drawing.summary,
        );
        if (committed) tell("Drawing updated.");
      } else if (result.kind === "request_user_input") {
        const pending = {
          ...pendingQuestions(outcome.context, result),
          messageId: replyId,
        };
        setUserInput(pending);
        setMessages((messages) =>
          messages.map((message) =>
            message.id === replyId
              ? { ...message, userInput: pending, recovery: undefined }
              : message,
          ),
        );
        finishReply("complete", questionText(result));
      } else if (result.kind === "message") {
        setUserInput(null);
        setMessages((messages) =>
          messages.map((message) =>
            message.id === replyId ? { ...message, userInput: null } : message,
          ),
        );
        finishReply("complete", result.message);
      } else if (result.kind === "clarification") {
        setUserInput(null);
        setClarification(input);
        setMessages((messages) =>
          messages.map((message) =>
            message.id === replyId
              ? {
                  ...message,
                  clarification: input,
                  userInput: null,
                  recovery: undefined,
                }
              : message,
          ),
        );
        finishReply("complete", result.question);
      } else if (result.kind !== "tool_calls") {
        onActivity({
          id: "final-validation",
          kind: "validation",
          status: "running",
          detail: "Checking the completed drawing before committing it.",
        });
        const change = drawingChange(result, input, baseDrawing);
        if (change.kind === "commit") {
          onActivity({
            id: "final-validation",
            kind: "validation",
            status: "completed",
            detail: "Drawing changes passed SVG and identity checks.",
          });
          const committed = offerDrawing(change.drawing);
          finishReply(committed ? "complete" : "reviewing", result.summary);
          if (committed) tell("Selected element updated.");
        } else {
          finishReply("validating", result.summary);
          setPending(change.candidate);
          const svg = await validateDrawingSource(
            change.candidate.html,
            controller.signal,
          );
          controller.signal.throwIfAborted();
          onActivity({
            id: "final-validation",
            kind: "validation",
            status: "completed",
            detail: "Drawing passed sandbox validation.",
          });
          const committed = offerDrawing({
            ...change.candidate,
            svg,
            html: svgToHTML(svg),
          });
          finishReply(committed ? "complete" : "reviewing", result.summary);
        }
      }
    } catch (error) {
      if (updateFrame !== undefined) cancelAnimationFrame(updateFrame);
      editContext.current = null;
      flush(true);
      if (clarification) setClarification(input);
      if (userInput) setUserInput(userInput);
      if ((error as Error).name === "AbortError") {
        if (controller.signal.reason?.message === "Generation stopped by user.")
          setMessages((messages) =>
            messages.map((message) =>
              message.id === replyId
                ? { ...message, recovery: undefined, resumable: false }
                : message,
            ),
          );
        finishReply("cancelled", undefined, true);
        tell("Generation stopped. Your drawing is unchanged.");
      } else {
        const resumable =
          error instanceof DrawingAgentRecoveryError &&
          !controller.signal.aborted;
        if (activeIdRef.current !== activeProject?.id)
          tell((error as Error).message, true);
        setMessages((messages) =>
          messages.map((message) =>
            message.id === replyId
              ? {
                  ...message,
                  status: "error",
                  resumable,
                  activities: settleActivities(message.activities, "failed"),
                  error: (error as Error).message,
                  recovery: resumable ? error.checkpoint : message.recovery,
                }
              : message,
          ),
        );
        if (activeReply.current === replyId) activeReply.current = null;
      }
    } finally {
      if (updateFrame !== undefined) cancelAnimationFrame(updateFrame);
      if (abort.current === controller) {
        setBusy(false);
        setPending(null);
        abort.current = null;
      }
    }
  }

  const updateUserInput = (pending: Project["userInput"]) => {
    setUserInput(pending);
    if (pending?.messageId)
      setMessages((messages) =>
        messages.map((message) =>
          message.id === pending.messageId
            ? { ...message, userInput: pending }
            : message,
        ),
      );
  };
  const submitUserInput = async (response: UserInputResponse) => {
    if (!userInput || busy || projectBusy) return;
    if (!config.apiKey || !config.model) {
      setSettings(true);
      return;
    }
    try {
      const answer = answerQuestions(userInput, response);
      if (answer.kind === "next") {
        updateUserInput(answer.pending);
        return;
      }
      const project = projectsRef.current.find(
        (project) => project.id === activeId,
      );
      const questionId =
        userInput.messageId ||
        [...messages]
          .reverse()
          .find(
            (message) =>
              message.role === "assistant" &&
              message.text === questionText(userInput.request),
          )?.id;
      if (!project || !questionId) return;
      const previous = project.conversation.nodes.find(
        (node) =>
          node.parentId === questionId &&
          node.message.role === "user" &&
          node.message.text === answer.message.text,
      );
      const failed =
        previous &&
        [...project.conversation.nodes]
          .reverse()
          .find(
            (node) =>
              node.parentId === previous.message.id &&
              (node.message.status === "error" ||
                node.message.status === "cancelled"),
          );
      if (failed) {
        await retryResponse(failed.message.id);
        return;
      }
      const restored = restoreConversation(project, questionId);
      const base = restored.history.items[restored.history.index];
      updateProject(project.id, () => ({
        ...restored,
        messages: [
          ...restored.messages,
          {
            ...answer.message,
            id: crypto.randomUUID(),
            canvas: base,
            userInput,
            clarification: null,
          },
        ],
      }));
      await runAI(answer.context, undefined, base);
    } catch (error) {
      tell((error as Error).message, true);
    }
  };
  const cancelUserInput = () => {
    setUserInput(null);
    setMessages((messages) =>
      messages.map((message, index) =>
        index === messages.length - 1
          ? { ...message, userInput: null }
          : message,
      ),
    );
  };

  const sendChat = async (inputText: string, files: ChatAttachment[]) => {
    const text =
      inputText.trim() ||
      (files.length
        ? t(
            "Use this reference sketch to create or refine the drawing. Read its dimensions and ask for anything essential that is unclear.",
          )
        : "");
    if (
      !text ||
      busy ||
      abort.current ||
      review ||
      projectBusy ||
      !loaded ||
      userInput
    )
      return;
    if (!config.apiKey || !config.model) {
      setSettings(true);
      throw new Error(t("Connect an AI model to start drawing."));
    }
    setMessages((m) => [
      ...m,
      {
        id: crypto.randomUUID(),
        role: "user",
        text,
        attachments: files,
        selectedIds: selection.ids,
        canvas: drawing,
        userInput: null,
        clarification: null,
      },
    ]);
    await runAI({
      ...drawingContext(
        text,
        messages,
        drawing,
        undefined,
        selectedId || undefined,
        clarification,
        selection.ids,
      ),
      attachments: clarification?.attachments || files,
    });
  };
  const retryResponse = async (id: string) => {
    if (busy || review || abort.current) return;
    if (!config.apiKey || !config.model) {
      setSettings(true);
      return;
    }
    const project = projectsRef.current.find(
      (project) => project.id === activeId,
    );
    if (!project) return;
    const node = project.conversation.nodes.find(
      (node) => node.message.id === id,
    );
    const userId = node?.message.role === "user" ? id : node?.parentId;
    if (!userId) return;
    const reply =
      node?.message.role === "assistant"
        ? node.message
        : [...project.conversation.nodes]
            .reverse()
            .find((node) => node.parentId === userId)?.message;
    const restored = restoreConversation(project, userId);
    const user = restored.messages.at(-1)!;
    const base = restored.history.items[restored.history.index];
    const retry = reply?.status === "error" || reply?.status === "cancelled";
    if (
      retry &&
      !sameCanvas(base, project.history.items[project.history.index])
    ) {
      const error =
        "Revision conflict: the committed drawing changed. Start a new request.";
      setMessages((messages) =>
        messages.map((message) =>
          message.id === reply?.id
            ? { ...message, error, status: "error" }
            : message,
        ),
      );
      return;
    }
    const checkpoint =
      retry && reply.recovery
        ? { ...reply.recovery, attempt: reply.recovery.attempt + 1 }
        : undefined;
    const context = checkpoint?.context ||
      reply?.request || {
        ...drawingContext(
          user.text,
          restored.messages.slice(0, -1),
          base,
          user.reference?.data,
          user.selectedIds?.[0],
          undefined,
          user.selectedIds,
        ),
        attachments: user.attachments,
      };
    updateProject(project.id, () => restored);
    setSelection(EMPTY_SELECTION);
    await runAI(context, checkpoint, base, retry ? reply.id : undefined);
  };
  const switchConversation = (id: string) => {
    if (busy || review || projectBusy || abort.current) return;
    updateProject(activeId, (project) => restoreConversation(project, id));
    setSelection(EMPTY_SELECTION);
    editContext.current = null;
  };
  const editMessage = async (
    id: string,
    text: string,
    files: ChatAttachment[],
  ) => {
    if (busy || review || abort.current || !text.trim()) return;
    if (!config.apiKey || !config.model) {
      setSettings(true);
      throw new Error(t("Connect an AI model to start drawing."));
    }
    const project = projectsRef.current.find(
      (project) => project.id === activeId,
    );
    const node = project?.conversation.nodes.find(
      (node) => node.message.id === id,
    );
    if (!project || !node?.parentId || node.message.role !== "user") return;
    let restored = restoreConversation(project, node.parentId);
    const base =
      node.message.canvas === undefined
        ? restored.history.items[restored.history.index]
        : node.message.canvas;
    if (!sameCanvas(base, restored.history.items[restored.history.index]))
      restored = { ...restored, history: pushHistory(restored.history, base) };
    const edited: ChatMessage = {
      ...node.message,
      id: crypto.randomUUID(),
      text: text.trim(),
      attachments: files,
      canvas: base,
      userInput: null,
      clarification: null,
    };
    updateProject(project.id, () => ({
      ...restored,
      messages: [...restored.messages, edited],
    }));
    setSelection(EMPTY_SELECTION);
    await runAI(
      {
        ...drawingContext(
          edited.text,
          restored.messages,
          base,
          edited.reference?.data,
          edited.selectedIds?.[0],
          undefined,
          edited.selectedIds,
        ),
        attachments: files,
      },
      undefined,
      base,
    );
  };
  const useExample = async () => {
    const projectId = activeIdRef.current;
    const target = composer.current;
    if (!target) return;
    const revision = target.getDraftRevision();
    try {
      const image = new Image();
      image.src = "/example-sketch.svg";
      await image.decode();
      if (activeIdRef.current !== projectId || composer.current !== target)
        return;
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      canvas.getContext("2d")!.drawImage(image, 0, 0);
      target.addAttachment({
        id: crypto.randomUUID(),
        type: "image",
        size: 0,
        name: "mounting-plate-sketch.png",
        image: canvas.toDataURL("image/png"),
      });
      target.setDraft(
        t(
          "120 × 80 mm plate, R8 corners. Four Ø10 holes; centers 20 mm from each edge.",
        ),
        revision,
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
        `${drawing.title.replace(/[^\p{L}\p{N}_-]+/gu, "-").toLowerCase()}${annotations ? "-dimensioned" : ""}.svg`,
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
    setSelection(EMPTY_SELECTION);
    setClarification(null);
  };

  if (!loaded)
    return (
      <div className="workspace-opening" role="status">
        <Loader2 className="spin" size={24} />
        {t("Opening your workspace…")}
      </div>
    );

  return (
    <div className="app">
      <header className="app-header">
        <button
          className="icon-button sidebar-toggle"
          aria-label={sidebarOpen ? t("Collapse sidebar") : t("Expand sidebar")}
          title={sidebarOpen ? t("Collapse sidebar") : t("Expand sidebar")}
          aria-expanded={sidebarOpen}
          aria-controls="drawing-sidebar"
          onClick={() => setSidebarOpen(!sidebarOpen)}
        >
          {sidebarOpen ? (
            <PanelLeftClose size={19} />
          ) : (
            <PanelLeftOpen size={19} />
          )}
        </button>
        <a className="brand" href="#" aria-label={t("Draftline home")}>
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
          <span className="beta">{t("BETA")}</span>
        </div>
        <div className="header-actions">
          <LanguageSelect />
          <button
            className="button settings-button"
            aria-label={t("Model settings")}
            onClick={() => setSettings(true)}
          >
            <Settings2 size={16} /> <span>{t("Model settings")}</span>
            <span
              className={`connection-dot ${config.apiKey && config.model ? "connected" : ""}`}
            />
          </button>
          <div className="export-wrap" ref={exporting}>
            <button
              className="button primary"
              disabled={busy || !!review || !drawing}
              onClick={() => setExportOpen(!exportOpen)}
            >
              <ArrowDownToLine size={16} />
              {t("Export SVG")}
              <ChevronDown size={14} />
            </button>
            {exportOpen && (
              <div className="export-menu">
                <div className="menu-label">{t("EXPORT DRAWING")}</div>
                <button onClick={() => exportDrawing(true)}>
                  <FileCode2 size={17} />
                  <span>
                    {t("With dimensions")}
                    <small>{t("Dimensions, title & technical notes")}</small>
                  </span>
                  <ArrowRight size={14} />
                </button>
                <button onClick={() => exportDrawing(false)}>
                  <Layers2 size={17} />
                  <span>
                    {t("Geometry only")}
                    <small>{t("Clean vector outlines")}</small>
                  </span>
                  <ArrowRight size={14} />
                </button>
                <p>{t("Standalone SVG · true millimeter scale")}</p>
              </div>
            )}
          </div>
        </div>
      </header>
      <main
        className={`studio ${sidebarOpen ? "sidebar-open" : "sidebar-closed"}`}
      >
        <DrawingSidebar
          open={sidebarOpen}
          onToggle={setSidebarOpen}
          projects={projects}
          activeId={activeId}
          disabled={projectBusy}
          projectBusy={projectBusy}
          onOpen={(id) => void changeProject(id)}
          onRename={renameProject}
          onDelete={removeProject}
          onHelp={() => setHelp(true)}
        />
        <section
          className="drawing-workspace"
          aria-label={t("Drawing workspace")}
        >
          <div className="canvas-toolbar">
            <div className="canvas-tabs">
              <button
                className={tab === "drawing" ? "active" : ""}
                onClick={() => setTab("drawing")}
              >
                <Layers2 size={14} />
                {t("Drawing")}
              </button>
              <button
                className={tab === "code" ? "active" : ""}
                disabled={!!review}
                onClick={() => setTab("code")}
              >
                <Code2 size={15} />
                {t("Code")}
              </button>
            </div>
            <div className="canvas-tools">
              <button
                className={`icon-button ${objectsOpen ? "active" : ""}`}
                aria-label={t("Objects and groups")}
                title={t("Objects and groups")}
                aria-expanded={objectsOpen}
                aria-controls="canvas-objects"
                disabled={!drawing || tab !== "drawing"}
                onClick={() => setObjectsOpen(!objectsOpen)}
              >
                <Layers2 size={17} />
              </button>
              <DrawingLayers
                layers={layers}
                onChange={setLayers}
                disabled={!drawing || tab !== "drawing"}
              />
              <span className="tool-separator" />
              <button
                className={`icon-button ${mode === "select" ? "active" : ""}`}
                aria-label={t("Select tool")}
                title={t("Select (V)")}
                onClick={() => setMode("select")}
              >
                <MousePointer2 size={17} />
              </button>
              <button
                className={`icon-button ${mode === "pan" ? "active" : ""}`}
                aria-label={t("Pan tool")}
                title={t("Pan (H)")}
                onClick={() => setMode("pan")}
              >
                <Hand size={17} />
              </button>
              <span className="tool-separator" />
              <button
                className="icon-button"
                aria-label={t("Undo")}
                title={t("Undo (Ctrl Z)")}
                disabled={
                  history.index === 0 || busy || !!review || !!userInput
                }
                onClick={() => navigate(-1)}
              >
                <Undo2 size={17} />
              </button>
              <button
                className="icon-button"
                aria-label={t("Redo")}
                title={t("Redo (Ctrl Shift Z)")}
                disabled={
                  history.index === history.items.length - 1 ||
                  busy ||
                  !!review ||
                  !!userInput
                }
                onClick={() => navigate(1)}
              >
                <Redo2 size={17} />
              </button>
              <span className="tool-separator" />
              <button
                className="icon-button"
                aria-label={t("Fit drawing")}
                title={t("Fit drawing")}
                onClick={() => preview.current?.send("fit")}
              >
                <Maximize size={16} />
              </button>
            </div>
          </div>
          <div className="canvas-document-heading">
            <span>{drawing?.title || activeProject?.name}</span>
            <span className="document-chip">
              {!drawing
                ? t("NEW DRAWING")
                : drawing.summary.startsWith("Example")
                  ? t("EXAMPLE DRAWING")
                  : t("VECTOR DRAWING")}
            </span>
          </div>
          <div className={`canvas ${tab === "code" ? "show-code" : ""}`}>
            {drawing ? (
              <Preview
                key={activeId}
                ref={preview}
                html={previewHTML}
                onSnapshot={(snapshot) => setElements(snapshot.elements)}
                onSelection={(next) => {
                  if (review) return;
                  setSelection({
                    ids: normalizeSelection(next.ids, elements),
                    rootId: elements.some(
                      (element) =>
                        element.id === next.rootId &&
                        element.tag === "g" &&
                        element.layer === "geometry",
                    )
                      ? next.rootId
                      : null,
                  });
                }}
                onCommand={(command) => {
                  if (busy || review || userInput || projectBusy) return;
                  if (command === "group" || command === "ungroup")
                    changeGrouping(command);
                  if (command === "undo" && history.index > 0) navigate(-1);
                  if (
                    command === "redo" &&
                    history.index < history.items.length - 1
                  )
                    navigate(1);
                  if (command === "pan" || command === "select")
                    setMode(command);
                }}
                onError={(text) => tell(text, true)}
                onZoom={setZoom}
                selection={selection}
                locked={!!review || !!userInput || projectBusy}
                changedIds={review?.changes.ids}
                layers={layers}
                mode={mode}
              />
            ) : (
              <div className="empty-canvas">
                <div className="assistant-mark">
                  <Sparkles size={24} />
                </div>
                <h2>{t("A fresh page for your next idea.")}</h2>
                <p>
                  {t("Describe your part or attach a sketch")}
                  <br />
                  {t("in the drawing assistant to get started.")}
                </p>
                <span>{t("Precise vectors · millimeter scale")}</span>
              </div>
            )}
            {tab === "code" && (
              <div className="code-panel">
                <div className="code-heading">
                  <span>
                    <Code2 size={16} />
                    {t("Drawing source")}
                  </span>
                  <div className="code-actions">
                    <button
                      className="button small"
                      disabled={busy || formattingCode || !!userInput}
                      onClick={formatCode}
                    >
                      {formattingCode ? t("Formatting…") : t("Format")}
                    </button>
                    <button
                      className="button small primary"
                      disabled={busy || formattingCode || !!userInput}
                      onClick={async () => {
                        editContext.current = null;
                        const candidate = {
                          title:
                            drawing?.title ||
                            activeProject?.name ||
                            t("Untitled drawing"),
                          html: code,
                          summary: t("Source code updated."),
                          notes: drawing?.notes,
                        };
                        setPending(candidate);
                        setBusy(true);
                        setTab("drawing");
                        const controller = new AbortController();
                        abort.current = controller;
                        try {
                          const svg = await validateDrawingSource(
                            candidate.html,
                            controller.signal,
                          );
                          controller.signal.throwIfAborted();
                          commit({ ...candidate, svg, html: svgToHTML(svg) });
                        } catch (error) {
                          if ((error as Error).name !== "AbortError")
                            tell((error as Error).message, true);
                        } finally {
                          if (abort.current === controller)
                            abort.current = null;
                          setPending(null);
                          setBusy(false);
                        }
                      }}
                    >
                      {t("Apply code")}
                      <Check size={13} />
                    </button>
                  </div>
                </div>
                <Suspense
                  fallback={
                    <div className="code-editor" role="status">
                      {t("Loading editor…")}
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
                  <ShieldCheck size={13} />
                  {t(
                    "HTML, SVG & synchronous JavaScript run inside the drawing sandbox.",
                  )}
                </div>
              </div>
            )}
            {tab === "drawing" && drawing && objectsOpen && (
              <ObjectTree
                elements={elements}
                selection={selection}
                onChange={setSelection}
                onClose={() => setObjectsOpen(false)}
              />
            )}
            {tab === "drawing" &&
              drawing &&
              (selection.ids.length > 0 || selection.rootId) && (
                <div className="canvas-selection">
                  <SelectionPanel
                    elements={elements}
                    selection={selection}
                    disabled={busy || !!review || !!userInput || projectBusy}
                    onChange={setSelection}
                    onGroup={() => changeGrouping("group")}
                    onUngroup={() => changeGrouping("ungroup")}
                  />
                </div>
              )}
            {busy && (
              <div className="canvas-loading">
                <Loader2 className="spin" size={20} />
                <span>
                  {pending
                    ? t("Checking your drawing…")
                    : runningActivity
                      ? `${t(activityLabel(runningActivity))}…`
                      : t("Receiving AI response…")}
                </span>
                <button onClick={cancelGeneration}>{t("Cancel")}</button>
              </div>
            )}
          </div>
          <footer className="canvas-footer">
            <div className="canvas-hint">
              <MousePointer2 size={13} />
              <span>
                {selection.ids.length > 1
                  ? t("{{count}} objects selected", {
                      count: selection.ids.length,
                    })
                  : selected
                    ? t("{{name}} selected", { name: selected.label })
                    : drawing
                      ? t("Click any element to refine it with AI")
                      : t("Your drawing starts in the assistant")}
              </span>
            </div>
            <div className="zoom-controls">
              <button
                aria-label={t("Zoom out")}
                onClick={() => preview.current?.send("zoom", -1)}
              >
                <Minus size={15} />
              </button>
              <span>{zoom}%</span>
              <button
                aria-label={t("Zoom in")}
                onClick={() => preview.current?.send("zoom", 1)}
              >
                <Plus size={15} />
              </button>
              <span className="zoom-divider" />
              <button
                aria-label={t("Reset view")}
                onClick={() => preview.current?.send("fit")}
              >
                <Focus size={16} />
              </button>
            </div>
            <div className="canvas-status">
              <span>
                <span className="status-dot" />{" "}
                {review
                  ? t("Review AI changes")
                  : busy
                    ? t("AI is working")
                    : t("Ready")}
                <span className="status-divider">/</span>
                {elements.filter((e) => e.layer === "geometry").length}{" "}
                {t("geometry elements")}
              </span>
              <span>
                <span className="scale-icon">↔</span>
                {t("1 unit = 1 mm")} <span className="status-divider">/</span>{" "}
                SVG
              </span>
            </div>
          </footer>
        </section>
        <AssistantChat
          key={activeId}
          ref={composer}
          messages={messages}
          conversation={activeProject!.conversation}
          busy={busy}
          disabled={projectBusy || !!review || (!!userInput && !busy)}
          initialDraft={chatInput}
          initialAttachments={attachments}
          onDraft={setChatInput}
          onAttachments={setAttachments}
          onSend={sendChat}
          onCancel={cancelGeneration}
          onRetry={retryResponse}
          onEdit={editMessage}
          onBranch={switchConversation}
          onAttachmentError={(message) => tell(message, true)}
        >
          <aside className="assistant-panel">
            <div className="assistant-heading">
              <div className="assistant-mark">
                <Sparkles size={19} />
              </div>
              <div>
                <h2>{t("Drawing assistant")}</h2>
                <p>
                  <span />{" "}
                  {busy
                    ? t("Working on your drawing")
                    : t("A little help, a lot of precision")}
                </p>
              </div>
            </div>
            <ConversationHistory
              conversation={activeProject!.conversation}
              disabled={busy || !!review || projectBusy}
              onRestore={switchConversation}
            />
            <ChatTranscript
              messages={messages}
              hasDrawing={!!drawing}
              onSuggest={(text) => composer.current?.setDraft(text)}
              onRestore={switchConversation}
            />
            <div className="assistant-controls">
              {review ? (
                <ReviewChanges
                  changes={review.changes}
                  summary={review.drawing.summary}
                  onApply={() => {
                    commit(review.drawing);
                    finishReply("complete");
                    tell("Drawing updated.");
                  }}
                  onDiscard={() => {
                    setReview(null);
                    editContext.current = null;
                    finishReply("cancelled");
                    tell("Proposal discarded. Your drawing is unchanged.");
                  }}
                />
              ) : (
                <>
                  {userInput && !busy ? (
                    <RequestUserInput
                      key={`${activeId}:${userInput.request.calls[userInput.callIndex].id}`}
                      args={questionArgs(
                        userInput.request,
                        userInput.callIndex,
                      )}
                      state={userInput.state}
                      disabled={busy || projectBusy}
                      onChange={(state) =>
                        updateUserInput({ ...userInput, state })
                      }
                      onSubmit={submitUserInput}
                      onCancel={cancelUserInput}
                    />
                  ) : (
                    <>
                      {clarification && (
                        <div className="clarification-banner">
                          <CircleHelp size={15} />
                          {t(
                            "A measurement is needed. Reply below to continue.",
                          )}
                        </div>
                      )}
                      <ChatComposer
                        busy={busy}
                        selectionCount={selection.ids.length}
                        onClearSelection={() => setSelection(EMPTY_SELECTION)}
                        placeholder={
                          clarification
                            ? t("Add the missing dimensions…")
                            : selection.ids.length
                              ? t("Describe changes to the selected objects…")
                              : drawing
                                ? t("Describe a change to your drawing…")
                                : t("Describe your part and dimensions in mm…")
                        }
                      >
                        {messages.length === 1 && (
                          <button
                            type="button"
                            className="example-button"
                            onClick={useExample}
                            disabled={busy || projectBusy}
                          >
                            {t("Try an example")}
                            <ArrowRight size={12} />
                          </button>
                        )}{" "}
                        <div className="assistant-model">
                          <span
                            className={`connection-dot ${config.apiKey && config.model ? "connected" : ""}`}
                          />
                          <button onClick={() => setSettings(true)}>
                            {config.apiKey && config.model
                              ? config.model
                              : t("Connect your AI model")}
                            <ChevronDown size={11} />
                          </button>
                          <span>{t("↵ to send")}</span>
                        </div>
                      </ChatComposer>
                    </>
                  )}
                </>
              )}
            </div>
          </aside>
        </AssistantChat>
      </main>
      {notice && (
        <div
          className={`toast ${notice.error ? "error" : ""}`}
          role={notice.error ? "alert" : "status"}
        >
          {notice.error ? <CircleHelp size={17} /> : <Check size={17} />}
          <span>{t(notice.text)}</span>
          <button
            aria-label={t("Dismiss notification")}
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
              tell(t("Saved model settings cleared."));
            } catch {
              tell(
                t(
                  "Saved settings could not be cleared. Please check browser storage access.",
                ),
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
                t(
                  "Settings work for this session, but browser storage could not save them.",
                ),
                true,
              );
              return;
            }
            tell(t("Model settings saved in this browser."));
          }}
        />
      )}
      {help && (
        <div className="help-backdrop" onClick={() => setHelp(false)}>
          <div
            className="help-card"
            role="dialog"
            aria-modal="true"
            aria-label={t("How Draftline works")}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="icon-button help-close"
              aria-label={t("Close help")}
              onClick={() => setHelp(false)}
            >
              <X size={18} />
            </button>
            <div className="dialog-icon">
              <Sparkles size={22} />
            </div>
            <h2>{t("From sketch to SVG.")}</h2>
            <p>
              {t(
                "1. Connect an OpenAI-compatible vision model in Model settings.",
              )}
            </p>
            <p>
              {t(
                "2. Start a New Drawing. Attach or paste a sketch in the assistant, add essential dimensions, and send. Reply there to clarify measurements.",
              )}
            </p>
            <p>
              {t(
                "3. Click or drag to select objects, Shift-click to toggle, and double-click to enter groups. Describe your edit; review broader AI changes before applying. Use the hand tool to pan and scroll to zoom.",
              )}
            </p>
            <p>
              {t(
                "4. Export geometry or a dimensioned SVG. The SVG preserves millimeter scale, with page margins for annotations.",
              )}
            </p>
            <small>
              {t(
                "Projects, conversations, sketches and model settings are saved in this browser. Sending a request shares its sketch and drawing with your selected provider.",
              )}
            </small>
            <button className="button primary" onClick={() => setHelp(false)}>
              {t("Let’s draw")}
              <ArrowRight size={15} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

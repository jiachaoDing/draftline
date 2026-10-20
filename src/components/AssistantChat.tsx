import {
  forwardRef,
  createContext,
  useContext,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  type AttachmentAdapter,
  MessageNotSentError,
  type ComposerRuntime,
  type ThreadMessage,
} from "@assistant-ui/react";
import {
  attachmentsSchema,
  type ChatAttachment,
  type ChatMessage,
} from "../lib/contracts";
import { ATTACHMENT_ACCEPT, parseAttachment } from "../lib/attachments";
import { runtimeAttachment, savedAttachment } from "../lib/chat-runtime";
import { runtimeRepository, type Conversation } from "../lib/conversation";

export type AssistantChatHandle = {
  getDraftRevision: () => number;
  setDraft: (text: string, expectedRevision?: number) => void;
  addAttachment: (item: ChatAttachment) => void;
};

const ComposerContext = createContext<ComposerRuntime | null>(null);

/** Read the authoritative runtime directly, before its batched UI projection. */
export function useComposerText() {
  const composer = useContext(ComposerContext);
  if (!composer) throw new Error("Composer requires AssistantChat");
  return useSyncExternalStore(composer.subscribe, () => {
    const state = composer.getState();
    return state.isEditing ? state.text : "";
  });
}

type Props = {
  messages: ChatMessage[];
  conversation: Conversation;
  busy: boolean;
  disabled: boolean;
  initialDraft: string;
  initialAttachments: ChatAttachment[];
  onDraft: (text: string) => void;
  onAttachments: (items: ChatAttachment[]) => void;
  onSend: (text: string, attachments: ChatAttachment[]) => Promise<void>;
  onCancel: () => void;
  onRetry: (id: string) => Promise<void>;
  onEdit: (
    id: string,
    text: string,
    attachments: ChatAttachment[],
  ) => Promise<void>;
  onBranch: (id: string) => void;
  onAttachmentError: (message: string) => void;
  children: ReactNode;
};

export default forwardRef<AssistantChatHandle, Props>(
  function AssistantChat(props, ref) {
    const initial = useRef({
      draft: props.initialDraft,
      attachments: props.initialAttachments,
    });
    const initialized = useRef(false);
    const draftRevision = useRef(0);
    const callbacks = useRef(props);
    callbacks.current = props;
    const reservations = useRef(
      new Map(props.initialAttachments.map((item) => [item.id, item.size])),
    );
    const adapter = useMemo<AttachmentAdapter>(
      () => ({
        accept: ATTACHMENT_ACCEPT,
        async *add({ file }) {
          const id = crypto.randomUUID();
          try {
            if (
              reservations.current.size >= 10 ||
              [...reservations.current.values()].reduce(
                (sum, size) => sum + size,
                0,
              ) +
                file.size >
                8 * 1024 * 1024
            )
              throw new Error("Attachments must total less than 8 MB.");
            reservations.current.set(id, file.size);
            yield {
              id,
              type: "file",
              name: file.name,
              file,
              status: { type: "running", reason: "uploading", progress: 0 },
            };
            const item = await parseAttachment(file);
            item.id = id;
            const complete = runtimeAttachment(item);
            yield {
              ...complete,
              file,
              status: { type: "requires-action", reason: "composer-send" },
            };
          } catch (error) {
            reservations.current.delete(id);
            yield {
              id,
              type: "file",
              name: file.name,
              file,
              status: {
                type: "incomplete",
                reason: "error",
                message: (error as Error).message,
              },
            };
          }
        },
        async send(attachment) {
          const saved = savedAttachment(attachment);
          if (!saved)
            throw new Error("Remove failed attachments before sending.");
          return runtimeAttachment(saved);
        },
        async remove(attachment) {
          reservations.current.delete(attachment.id);
        },
      }),
      [],
    );
    const repository = useMemo(
      () => runtimeRepository(props.conversation),
      [props.conversation],
    );
    const runtime = useExternalStoreRuntime<ThreadMessage>({
      messageRepository: repository,
      setMessages: () => {},
      unstable_onBranchChange: ({ headId }) => {
        if (headId) callbacks.current.onBranch(headId);
      },
      isRunning: props.busy,
      isDisabled: props.disabled,
      onNew: async (message) => {
        const items = (message.attachments || [])
          .map(savedAttachment)
          .filter((item) => item !== undefined);
        const validated = attachmentsSchema.safeParse(items);
        if (!validated.success)
          throw new MessageNotSentError(validated.error.issues[0].message);
        const text = message.content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n");
        try {
          await callbacks.current.onSend(text, validated.data);
          reservations.current.clear();
        } catch (error) {
          throw new MessageNotSentError((error as Error).message);
        }
      },
      onCancel: async () => callbacks.current.onCancel(),
      onEdit: async (message) => {
        const text = message.content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n");
        const items = (message.attachments || [])
          .map(savedAttachment)
          .filter((item) => item !== undefined);
        try {
          await callbacks.current.onEdit(message.sourceId!, text, items);
        } catch (error) {
          throw new MessageNotSentError((error as Error).message);
        }
      },
      onReload: async (id, config) => {
        const targetId = config.sourceId || id;
        if (targetId) await callbacks.current.onRetry(targetId);
      },
      adapters: { attachments: adapter },
    });
    useImperativeHandle(
      ref,
      () => ({
        getDraftRevision: () => draftRevision.current,
        setDraft: (text, expectedRevision) => {
          const composer = runtime.thread.composer;
          if (
            expectedRevision === undefined ||
            draftRevision.current === expectedRevision
          )
            composer.setText(text);
        },
        addAttachment: (item) => {
          reservations.current.set(item.id, item.size);
          const { status: _status, ...attachment } = runtimeAttachment(item);
          void runtime.thread.composer.addAttachment(attachment);
        },
      }),
      [runtime],
    );
    useEffect(
      () =>
        runtime.thread.composer.unstable_on("attachmentAddError", (event) => {
          if (event.reason === "not-accepted" || event.reason === "no-adapter")
            callbacks.current.onAttachmentError(
              "Choose an image, SVG, PDF, DXF, or text file.",
            );
        }),
      [runtime],
    );
    useLayoutEffect(() => {
      // Restore once per project runtime. Persistence is an observer, never an
      // input value source after editing starts (including StrictMode replay).
      if (!initialized.current) {
        initialized.current = true;
        runtime.thread.composer.setText(initial.current.draft);
        for (const item of initial.current.attachments) {
          const { status: _status, ...attachment } = runtimeAttachment(item);
          void runtime.thread.composer.addAttachment(attachment);
        }
      }
      let previousText = runtime.thread.composer.getState().text;
      let previousAttachments = JSON.stringify(
        runtime.thread.composer
          .getState()
          .attachments.map(savedAttachment)
          .filter((item) => item !== undefined),
      );
      return runtime.thread.composer.subscribe(() => {
        const state = runtime.thread.composer.getState();
        if (state.text !== previousText) {
          previousText = state.text;
          draftRevision.current++;
          callbacks.current.onDraft(state.text);
        }
        const items = state.attachments
          .map(savedAttachment)
          .filter((item) => item !== undefined);
        const serialized = JSON.stringify(items);
        if (serialized !== previousAttachments) {
          previousAttachments = serialized;
          callbacks.current.onAttachments(items);
        }
      });
    }, [runtime]);
    return (
      <AssistantRuntimeProvider runtime={runtime}>
        <ComposerContext.Provider value={runtime.thread.composer}>
          {props.children}
        </ComposerContext.Provider>
      </AssistantRuntimeProvider>
    );
  },
);

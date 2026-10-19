import { act, createElement, createRef, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { useAui } from "@assistant-ui/react";
import { expect, it, vi } from "vitest";
import AssistantChat, {
  type AssistantChatHandle,
} from "../src/components/AssistantChat";

it("keeps newer composer text when an older project draft renders during autosave", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let runtime: ReturnType<typeof useAui>;
  function Composer() {
    runtime = useAui();
    return null;
  }
  const onDraft = vi.fn();
  const handle = createRef<AssistantChatHandle>();
  const render = (draft: string) =>
    act(async () => {
      root.render(
        createElement(
          StrictMode,
          null,
          createElement(AssistantChat, {
            messages: [],
            busy: false,
            disabled: false,
            ref: handle,
            initialDraft: draft,
            initialAttachments: [],
            onDraft,
            onAttachments: () => {},
            onSend: async () => {},
            onCancel: () => {},
            onRetry: async () => {},
            onAttachmentError: () => {},
            children: createElement(Composer),
          }),
        ),
      );
    });
  try {
    await render("Saved draft");
    await act(async () => runtime.composer.setText("Saved draft ni"));
    await act(async () => runtime.composer.setText("Saved draft \u4f60\u597d"));
    onDraft.mockClear();
    await render("Saved draft ni");
    expect(runtime!.composer.getState().text).toBe("Saved draft \u4f60\u597d");
    expect(onDraft).not.toHaveBeenCalled();
    // An async example must not overwrite edits, even after an undo back to
    // the same string. Suggestions still explicitly update the live runtime.
    const revision = handle.current!.getDraftRevision();
    await act(async () => {
      runtime.composer.setText("Changed draft");
      runtime.composer.setText("Saved draft \u4f60\u597d");
      handle.current!.setDraft("Late example", revision);
    });
    expect(runtime!.composer.getState().text).toBe("Saved draft \u4f60\u597d");
    await act(async () => handle.current!.setDraft("Explicit suggestion"));
    expect(runtime!.composer.getState().text).toBe("Explicit suggestion");
    expect(onDraft).toHaveBeenLastCalledWith("Explicit suggestion");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

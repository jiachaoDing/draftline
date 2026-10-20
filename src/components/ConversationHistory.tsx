import { History } from "lucide-react";
import { useState } from "react";
import type { Conversation } from "../lib/conversation";
import { t, useLocale } from "../lib/i18n";

export default function ConversationHistory({
  conversation,
  disabled,
  onRestore,
}: {
  conversation: Conversation;
  disabled: boolean;
  onRestore: (id: string) => void;
}) {
  useLocale();
  const [open, setOpen] = useState(false);
  const parents = new Set(conversation.nodes.map((node) => node.parentId));
  const branches = conversation.nodes.filter(
    (node) => !parents.has(node.message.id),
  );
  if (conversation.nodes.length < 2) return null;
  return (
    <details
      className="conversation-history"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <History size={13} />
        {t("Conversation history")}
      </summary>
      {open && (
        <nav aria-label={t("Saved branches")}>
          {branches.map(({ message }, index) => (
            <button
              key={message.id}
              disabled={disabled}
              aria-current={
                message.id === conversation.headId ? "true" : undefined
              }
              onClick={(event) => {
                onRestore(message.id);
                event.currentTarget.closest("details")?.removeAttribute("open");
              }}
            >
              <span>{t("Branch {{number}}", { number: index + 1 })}</span>
              <span>
                {(
                  message.text ||
                  message.error ||
                  t("Response incomplete — drawing unchanged")
                ).slice(0, 100)}
              </span>
            </button>
          ))}
        </nav>
      )}
    </details>
  );
}

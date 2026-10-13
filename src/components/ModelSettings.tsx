import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  ExternalLink,
  Eye,
  EyeOff,
  Loader2,
  PlugZap,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react";
import type { ModelConfig } from "../lib/contracts";
import { discoverModels, testConnection } from "../lib/api";

type Props = {
  config: ModelConfig;
  onSave: (config: ModelConfig) => void;
  onClose: () => void;
};
export default function ModelSettings({ config, onSave, onClose }: Props) {
  const [draft, setDraft] = useState(config);
  const [models, setModels] = useState<string[]>([]);
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState("");
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const field = (name: keyof ModelConfig, value: string) => {
    setDraft({ ...draft, [name]: value });
    setStatus(null);
  };
  const connect = async (action: "discover" | "test") => {
    setBusy(action);
    setStatus(null);
    try {
      if (action === "discover") {
        const result = await discoverModels(draft);
        setModels(result.models);
        setStatus({
          ok: true,
          text: `${result.models.length} models found. Choose a vision-capable model for sketches.`,
        });
      } else {
        await testConnection(draft);
        setStatus({
          ok: true,
          text: "Connected. Your selected model responded successfully.",
        });
      }
    } catch (error) {
      setStatus({ ok: false, text: (error as Error).message });
    } finally {
      setBusy("");
    }
  };
  return (
    <dialog
      ref={dialog}
      className="settings-dialog"
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSave({
            ...draft,
            baseURL: draft.baseURL.trim().replace(/\/+$/, ""),
            model: draft.model.trim(),
            apiKey: draft.apiKey.trim(),
          });
        }}
      >
        <div className="dialog-heading">
          <div className="dialog-icon">
            <PlugZap size={22} />
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Close model settings"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        <h2>Connect your AI</h2>
        <p className="muted">
          Bring your own model. Make it your drawing assistant.
        </p>
        <label className="field-label">
          Provider <span>OpenAI-compatible</span>
        </label>
        <div className="provider-options">
          <button
            type="button"
            className={
              draft.baseURL === "https://api.openai.com/v1" ? "active" : ""
            }
            onClick={() => field("baseURL", "https://api.openai.com/v1")}
          >
            OpenAI
          </button>
          <button
            type="button"
            className={
              draft.baseURL !== "https://api.openai.com/v1" ? "active" : ""
            }
            onClick={() => field("baseURL", "")}
          >
            NewAPI / Custom
          </button>
        </div>
        <label className="field-label" htmlFor="base-url">
          Base URL
        </label>
        <input
          id="base-url"
          type="url"
          required
          placeholder="https://your-newapi.example/v1"
          value={draft.baseURL}
          onChange={(e) => field("baseURL", e.target.value)}
        />
        <label className="field-label" htmlFor="api-key">
          API key
        </label>
        <div className="input-with-action">
          <input
            id="api-key"
            required
            type={showKey ? "text" : "password"}
            autoComplete="off"
            placeholder="sk-…"
            value={draft.apiKey}
            onChange={(e) => field("apiKey", e.target.value)}
          />
          <button
            type="button"
            aria-label={showKey ? "Hide API key" : "Show API key"}
            onClick={() => setShowKey(!showKey)}
          >
            {showKey ? <EyeOff size={17} /> : <Eye size={17} />}
          </button>
        </div>
        <div className="field-row">
          <label className="field-label" htmlFor="model-id">
            Model
          </label>
          <button
            type="button"
            className="text-button"
            disabled={!!busy || !draft.apiKey || !draft.baseURL}
            onClick={() => connect("discover")}
          >
            {busy === "discover" ? (
              <Loader2 size={13} className="spin" />
            ) : (
              <RefreshCw size={13} />
            )}{" "}
            Discover models
          </button>
        </div>
        <div className="input-with-action">
          <input
            id="model-id"
            required
            list="model-list"
            placeholder="Enter or select a model"
            value={draft.model}
            onChange={(e) => field("model", e.target.value)}
          />
          <ChevronDown size={15} />
          <datalist id="model-list">
            {models.map((model) => (
              <option key={model} value={model} />
            ))}
          </datalist>
        </div>
        <p className="field-hint">
          Use a model with image input to interpret hand-drawn sketches.
        </p>
        {status && (
          <div
            className={`connection-status ${status.ok ? "success" : "error"}`}
            role="status"
          >
            {status.ok && <Check size={16} />}
            {status.text}
          </div>
        )}
        <div className="privacy-note">
          <ShieldCheck size={19} />
          <p>
            Your key stays in this page’s memory and is sent only to the app
            server and your provider. It is never saved, logged, or passed to
            drawing code.
          </p>
        </div>
        <div className="dialog-actions">
          <button
            type="button"
            className="button secondary"
            disabled={!!busy || !draft.apiKey || !draft.model || !draft.baseURL}
            onClick={() => connect("test")}
          >
            {busy === "test" ? (
              <Loader2 size={15} className="spin" />
            ) : (
              <PlugZap size={15} />
            )}{" "}
            Test connection
          </button>
          <button type="submit" className="button primary" disabled={!!busy}>
            Save settings <Check size={15} />
          </button>
        </div>
        <a
          className="settings-help"
          href="https://github.com/QuantumNous/new-api"
          target="_blank"
          rel="noreferrer"
        >
          About NewAPI <ExternalLink size={12} />
        </a>
      </form>
    </dialog>
  );
}

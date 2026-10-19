import { t, useLocale } from "../lib/i18n";
import { useEffect, useRef, useState } from "react";
import {
  Combobox,
  ComboboxButton,
  ComboboxInput,
  ComboboxOption,
  ComboboxOptions,
  Portal,
} from "@headlessui/react";
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
import {
  reasoningEffortSchema,
  type ModelConfig,
  type ReasoningEffort,
} from "../lib/contracts";
import { resolveReasoningEffort } from "../lib/model-reasoning";
import { discoverModels, testConnection } from "../lib/api";

const reasoningLabels: Record<ReasoningEffort, string> = {
  auto: "Automatic",
  provider: "Provider default",
  none: "None (none)",
  minimal: "Minimal (minimal)",
  low: "Low (low)",
  medium: "Medium (medium)",
  high: "High (high)",
  xhigh: "Extra high (xhigh)",
  max: "Maximum (max)",
};

type Props = {
  config: ModelConfig;
  onSave: (config: ModelConfig) => void;
  onClose: () => void;
  onClear: () => void;
};
export default function ModelSettings({
  config,
  onSave,
  onClose,
  onClear,
}: Props) {
  useLocale();
  const [draft, setDraft] = useState(config);
  const [models, setModels] = useState<string[]>([]);
  const [modelQuery, setModelQuery] = useState("");
  const modelButton = useRef<HTMLButtonElement>(null);
  const query = modelQuery.trim();
  const filteredModels = models.filter((model) =>
    model.toLowerCase().includes(query.toLowerCase()),
  );
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState("");
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const dialog = useRef<HTMLDialogElement>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => {
    dialog.current?.showModal();
    return () => abort.current?.abort();
  }, []);
  function field<Key extends keyof ModelConfig>(
    name: Key,
    value: ModelConfig[Key],
  ) {
    setDraft({ ...draft, [name]: value });
    setStatus(null);
  }
  const connect = async (action: "discover" | "test") => {
    setBusy(action);
    setStatus(null);
    const controller = new AbortController();
    abort.current = controller;
    try {
      if (action === "discover") {
        const result = await discoverModels(draft, controller.signal);
        setModels(result.models);
        setStatus({
          ok: true,
          text: t(
            "{{count}} models found. Choose a vision-capable model for sketches.",
            { count: result.models.length },
          ),
        });
      } else {
        let reply = "";
        await testConnection(draft, controller.signal, (text) => {
          if (controller.signal.aborted) return;
          reply += text;
          setStatus({ ok: true, text: t("Model reply: {{reply}}", { reply }) });
        });
        setStatus({
          ok: true,
          text: "Connected. Your selected model responded successfully.",
        });
      }
    } catch (error) {
      setStatus({
        ok: false,
        text: controller.signal.aborted
          ? "Connection test stopped."
          : (error as Error).message,
      });
    } finally {
      if (abort.current === controller) abort.current = null;
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
            aria-label={t("Close model settings")}
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        <h2>{t("Connect your AI")}</h2>
        <p className="muted">
          {t("Bring your own model. Make it your drawing assistant.")}
        </p>
        <label className="field-label">
          {t("Provider")}
          <span>{t("OpenAI-compatible")}</span>
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
            {t("NewAPI / Custom")}
          </button>
        </div>
        <label className="field-label" htmlFor="base-url">
          {t("Base URL")}
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
          {t("API key")}
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
            aria-label={showKey ? t("Hide API key") : t("Show API key")}
            onClick={() => setShowKey(!showKey)}
          >
            {showKey ? <EyeOff size={17} /> : <Eye size={17} />}
          </button>
        </div>
        <div className="field-row">
          <label className="field-label" htmlFor="model-id">
            {t("Model")}
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
            {t("Discover models")}
          </button>
        </div>
        <Portal.Group target={dialog}>
          <Combobox
            value={draft.model}
            onChange={(model) => field("model", model || "")}
            onClose={() => setModelQuery("")}
            immediate
            disabled={!!busy}
          >
            {({ open }) => (
              <>
                <div className="input-with-action model-combobox">
                  <ComboboxInput
                    id="model-id"
                    required
                    autoComplete="off"
                    aria-describedby="model-hint"
                    placeholder={t("Enter or select a model")}
                    displayValue={(model: string) => model}
                    onChange={(e) => {
                      setModelQuery(e.target.value);
                      field("model", e.target.value);
                    }}
                    onClick={() => {
                      if (!open) modelButton.current?.click();
                    }}
                  />
                  <ComboboxButton
                    ref={modelButton}
                    className="model-toggle"
                    aria-label={t("Show models")}
                    onClick={() => setModelQuery("")}
                  >
                    <ChevronDown size={15} aria-hidden="true" />
                  </ComboboxButton>
                </div>
                <ComboboxOptions
                  anchor={{ to: "bottom start", gap: 6, padding: 12 }}
                  modal={false}
                  className="model-options"
                  aria-label={t("Models")}
                >
                  {filteredModels.map((model) => (
                    <ComboboxOption
                      key={model}
                      value={model}
                      className="model-option"
                    >
                      <span>{model}</span>
                      <Check
                        size={14}
                        className="model-selected"
                        aria-hidden="true"
                      />
                    </ComboboxOption>
                  ))}
                  {query && !models.includes(query) && (
                    <ComboboxOption
                      value={query}
                      className="model-option model-custom"
                    >
                      <span>
                        {t("Use “{{model}}”", { model: query })}
                        <small>{t("Custom model ID")}</small>
                      </span>
                      <Check
                        size={14}
                        className="model-selected"
                        aria-hidden="true"
                      />
                    </ComboboxOption>
                  )}
                  {!models.length && !query && (
                    <p className="model-empty">
                      {t("Discover models above, or type a custom model ID.")}
                    </p>
                  )}
                  {!!models.length && !filteredModels.length && (
                    <p className="model-empty">
                      {t("No discovered models match your search.")}
                    </p>
                  )}
                </ComboboxOptions>
              </>
            )}
          </Combobox>
        </Portal.Group>
        <p className="field-hint" id="model-hint">
          {t("Use a model with image input to interpret hand-drawn sketches.")}
        </p>
        <label className="field-label" htmlFor="reasoning-effort">
          {t("Reasoning effort")}
        </label>
        <select
          id="reasoning-effort"
          value={draft.reasoningEffort ?? "auto"}
          disabled={!!busy}
          aria-describedby="reasoning-hint"
          onChange={(event) =>
            field(
              "reasoningEffort",
              reasoningEffortSchema.parse(event.target.value),
            )
          }
        >
          <option value="auto">
            {t("Automatic ({{effort}})", {
              effort: t(
                reasoningLabels[
                  resolveReasoningEffort({ model: draft.model }) ?? "provider"
                ],
              ),
            })}
          </option>
          {reasoningEffortSchema.options
            .filter((effort) => effort !== "auto")
            .map((effort) => (
              <option key={effort} value={effort}>
                {t(reasoningLabels[effort])}
              </option>
            ))}
        </select>
        <p className="field-hint" id="reasoning-hint">
          {t(
            "Automatic uses high for GPT-5/GPT-6 and o-series reasoning models. Supported levels depend on your provider; higher effort can take longer and use more tokens.",
          )}
        </p>
        {status && (
          <div
            className={`connection-status ${busy === "test" ? "pending" : status.ok ? "success" : "error"}`}
            role="status"
          >
            {busy === "test" ? (
              <Loader2 size={16} className="spin" />
            ) : (
              status.ok && <Check size={16} />
            )}
            {t(status.text)}
          </div>
        )}
        <div className="privacy-note">
          <ShieldCheck size={19} />
          <p>
            {t(
              "Settings, including your key, are saved in this browser. Requests share them only with the app server and your provider. Drawing code cannot access them. Clear saved settings below to remove them.",
            )}
          </p>
        </div>
        <div className="dialog-actions">
          <button
            type="button"
            className="button secondary"
            disabled={
              busy === "discover" ||
              (!busy && (!draft.apiKey || !draft.model || !draft.baseURL))
            }
            onClick={() =>
              busy === "test" ? abort.current?.abort() : connect("test")
            }
          >
            {busy === "test" ? (
              <Loader2 size={15} className="spin" />
            ) : (
              <PlugZap size={15} />
            )}{" "}
            {busy === "test" ? t("Cancel test") : t("Test connection")}
          </button>
          <button type="submit" className="button primary" disabled={!!busy}>
            {t("Save settings")}
            <Check size={15} />
          </button>
        </div>
        <button
          type="button"
          className="text-button clear-settings"
          disabled={!!busy}
          onClick={onClear}
        >
          {t("Clear saved settings")}
        </button>
        <a
          className="settings-help"
          href="https://github.com/QuantumNous/new-api"
          target="_blank"
          rel="noreferrer"
        >
          {t("About NewAPI")}
          <ExternalLink size={12} />
        </a>
      </form>
    </dialog>
  );
}

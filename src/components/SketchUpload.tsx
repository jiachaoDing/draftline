import { t, useLocale } from "../lib/i18n";
import { useRef } from "react";
import { ImagePlus, Upload, X } from "lucide-react";
export type Sketch = { data: string; name: string };
type Props = {
  sketch: Sketch | null;
  onFile: (file: File) => void;
  onClear: () => void;
  disabled: boolean;
};
export default function SketchUpload({
  sketch,
  onFile,
  onClear,
  disabled,
}: Props) {
  useLocale();
  const input = useRef<HTMLInputElement>(null);
  return (
    <div
      className={`upload-zone ${sketch ? "has-sketch" : ""}`}
      onDragOver={(event) => {
        event.preventDefault();
        event.currentTarget.classList.add("dragging");
      }}
      onDragLeave={(event) => event.currentTarget.classList.remove("dragging")}
      onDrop={(event) => {
        event.preventDefault();
        event.currentTarget.classList.remove("dragging");
        if (!disabled && event.dataTransfer.files[0])
          onFile(event.dataTransfer.files[0]);
      }}
    >
      <input
        ref={input}
        aria-label={t("Upload sketch image")}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={(event) => {
          if (event.target.files?.[0]) onFile(event.target.files[0]);
          event.target.value = "";
        }}
      />
      {sketch ? (
        <>
          <img src={sketch.data} alt={t("Uploaded sketch")} />
          <div className="sketch-caption">
            <span title={sketch.name}>{sketch.name}</span>
            <button
              className="icon-button"
              disabled={disabled}
              aria-label={t("Remove sketch")}
              onClick={onClear}
            >
              <X size={14} />
            </button>
          </div>
          <button
            className="replace-sketch"
            disabled={disabled}
            onClick={() => input.current?.click()}
          >
            <Upload size={12} />
            {t("Replace")}
          </button>
        </>
      ) : (
        <button
          className="upload-button"
          disabled={disabled}
          onClick={() => input.current?.click()}
        >
          <div className="upload-icon">
            <ImagePlus size={24} strokeWidth={1.6} />
          </div>
          <strong>{t("Attach reference sketch")}</strong>
          <span>
            {t("or")} <b>{t("browse files")}</b> {t("to upload")}
          </span>
          <small>{t("PNG, JPG, WebP · up to 8 MB")}</small>
        </button>
      )}
      {!sketch && (
        <div className="paste-hint">
          {t("You can also paste an image")} <kbd>Ctrl V</kbd>
        </div>
      )}
    </div>
  );
}

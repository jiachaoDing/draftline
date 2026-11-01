import { useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import { downloadFile } from "../lib/drawing";
import { exportProjectBackup } from "../lib/project-backup";
import type { Project } from "../lib/projects";
import { useLocale } from "../lib/i18n";

export default function ProjectBackup({
  project,
  disabled,
  onImport,
  onNotice,
}: {
  project?: Project;
  disabled: boolean;
  onImport: (text: string) => Promise<void>;
  onNotice: (message: string, error?: boolean) => void;
}) {
  const { t } = useLocale();
  const input = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  return (
    <div className="project-backup">
      <button
        className="sidebar-link"
        disabled={!project || disabled}
        onClick={() => {
          if (!project) return;
          try {
            downloadFile(
              exportProjectBackup(project),
              `${project.name.replace(/[^\p{L}\p{N}_-]+/gu, "-")}.draftline.json`,
              "application/json;charset=utf-8",
            );
            onNotice("Project backup exported.");
          } catch {
            onNotice(
              "The project could not be backed up. Please try again.",
              true,
            );
          }
        }}
      >
        <Download size={15} />
        {t("Back up project")}
      </button>
      <button
        className="sidebar-link"
        disabled={disabled || importing}
        onClick={() => input.current?.click()}
      >
        <Upload size={15} />
        {t(importing ? "Restoring project…" : "Restore project")}
      </button>
      <input
        ref={input}
        type="file"
        accept=".json"
        hidden
        aria-label={t("Project backup file")}
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          setImporting(true);
          try {
            if (file.size > 100 * 1024 * 1024)
              throw new Error("Backup too large");
            await onImport(await file.text());
            onNotice("Project restored as a new copy.");
          } catch {
            onNotice(
              "Could not restore the project. Use a valid Draftline backup under 100 MB and check browser storage.",
              true,
            );
          } finally {
            setImporting(false);
          }
        }}
      />
    </div>
  );
}

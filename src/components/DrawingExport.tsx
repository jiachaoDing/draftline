import { useState } from "react";
import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import { ArrowDownToLine, ChevronDown, Loader2 } from "lucide-react";
import { t, useLocale } from "../lib/i18n";
import { downloadFile, exportSVG } from "../lib/drawing";
import type { Drawing } from "../lib/contracts";

type Props = {
  drawing: Drawing | null;
  disabled: boolean;
  onNotice: (message: string, error?: boolean) => void;
};

export default function DrawingExport({ drawing, disabled, onNotice }: Props) {
  useLocale();
  const [exporting, setExporting] = useState("");
  const download = async (format: "svg" | "pdf") => {
    if (!drawing || exporting) return;
    setExporting("Exporting…");
    try {
      const name = drawing.title
        .replace(/[^\p{L}\p{N}_-]+/gu, "-")
        .toLowerCase();
      if (format === "svg") {
        downloadFile(
          exportSVG(drawing.svg),
          `${name}.svg`,
          "image/svg+xml;charset=utf-8",
        );
      } else {
        const { exportPDF } = await import("../lib/pdf-export");
        const bytes = await exportPDF(drawing.svg, setExporting);
        downloadFile(
          new Uint8Array(bytes).buffer,
          `${name}.pdf`,
          "application/pdf",
        );
      }
      onNotice(
        format === "svg"
          ? "SVG exported at its original millimeter scale."
          : "PDF exported at its original millimeter scale.",
      );
    } catch {
      onNotice("The drawing could not be exported. Please try again.", true);
    } finally {
      setExporting("");
    }
  };
  return (
    <Menu>
      <MenuButton
        className="button primary"
        disabled={disabled || !drawing || !!exporting}
      >
        {exporting ? (
          <Loader2 className="spin" size={16} />
        ) : (
          <ArrowDownToLine size={16} />
        )}
        <span aria-live="polite">{t(exporting || "Export")}</span>
        <ChevronDown size={14} />
      </MenuButton>
      <MenuItems anchor="bottom end" className="project-menu export-menu">
        {(["svg", "pdf"] as const).map((format) => (
          <MenuItem key={format}>
            <button
              disabled={!!exporting || disabled || !drawing}
              onClick={() => void download(format)}
            >
              {t(format === "svg" ? "Export SVG" : "Export PDF")}
            </button>
          </MenuItem>
        ))}
      </MenuItems>
    </Menu>
  );
}

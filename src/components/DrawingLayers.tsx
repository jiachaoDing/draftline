import { t, useLocale } from "../lib/i18n";
import { Popover, PopoverButton, PopoverPanel } from "@headlessui/react";
import { Layers2 } from "lucide-react";
import type { Project } from "../lib/projects";

type Props = {
  layers: Project["layers"];
  onChange: (layers: Project["layers"]) => void;
  disabled: boolean;
};

export default function DrawingLayers({ layers, onChange, disabled }: Props) {
  useLocale();
  return (
    <Popover className="drawing-layers">
      <PopoverButton
        className="icon-button layers-toggle"
        aria-label={t("Drawing layers")}
        title={t("Drawing layers")}
        disabled={disabled}
      >
        <Layers2 size={17} />
      </PopoverButton>
      <PopoverPanel anchor="bottom end" className="layers-popover">
        <h2>{t("Drawing layers")}</h2>
        {(["geometry", "dimensions", "presentation"] as const).map((layer) => (
          <label key={layer} className="layer-row">
            <input
              aria-label={t(`Show ${layer}`)}
              type="checkbox"
              checked={layers[layer]}
              onChange={(event) =>
                onChange({ ...layers, [layer]: event.target.checked })
              }
            />
            <span>
              {layer === "geometry"
                ? t("Geometry")
                : layer === "dimensions"
                  ? t("Dimensions")
                  : t("Sheet information")}
            </span>
          </label>
        ))}
      </PopoverPanel>
    </Popover>
  );
}

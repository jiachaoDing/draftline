import { Popover, PopoverButton, PopoverPanel } from "@headlessui/react";
import { Layers2 } from "lucide-react";
import type { Project } from "../lib/projects";

type Props = {
  layers: Project["layers"];
  onChange: (layers: Project["layers"]) => void;
  disabled: boolean;
};

export default function DrawingLayers({ layers, onChange, disabled }: Props) {
  return (
    <Popover className="drawing-layers">
      <PopoverButton
        className="icon-button layers-toggle"
        aria-label="Drawing layers"
        title="Drawing layers"
        disabled={disabled}
      >
        <Layers2 size={17} />
      </PopoverButton>
      <PopoverPanel anchor="bottom end" className="layers-popover">
        <h2>Drawing layers</h2>
        {(["geometry", "dimensions", "presentation"] as const).map((layer) => (
          <label key={layer} className="layer-row">
            <input
              aria-label={`Show ${layer}`}
              type="checkbox"
              checked={layers[layer]}
              onChange={(event) =>
                onChange({ ...layers, [layer]: event.target.checked })
              }
            />
            <span>
              {layer === "geometry"
                ? "Geometry"
                : layer === "dimensions"
                  ? "Dimensions"
                  : "Sheet information"}
            </span>
          </label>
        ))}
      </PopoverPanel>
    </Popover>
  );
}

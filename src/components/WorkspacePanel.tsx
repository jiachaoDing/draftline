import { Resizable } from "re-resizable";
import { useRef, type ReactNode } from "react";
import { t } from "../lib/i18n";

export default function WorkspacePanel({
  side,
  size,
  open,
  onResize,
  children,
}: {
  side: "left" | "right";
  size: number;
  open: boolean;
  onResize: (size: number) => void;
  children: ReactNode;
}) {
  const start = useRef(size);
  const label = t(
    side === "left" ? "Resize drawing panel" : "Resize conversation panel",
  );
  const handle = (
    <div
      className="panel-resize-handle"
      role="separator"
      tabIndex={open ? 0 : -1}
      aria-label={label}
      title={label}
      aria-orientation="vertical"
      aria-valuemin={side === "left" ? 200 : 280}
      aria-valuemax={side === "left" ? 360 : 560}
      aria-valuenow={size}
      onKeyDown={(event) => {
        const direction = side === "left" ? 1 : -1;
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          onResize(size + (event.key === "ArrowRight" ? 16 : -16) * direction);
        } else if (event.key === "Home" || event.key === "End") {
          event.preventDefault();
          onResize(
            event.key === "Home"
              ? side === "left"
                ? 200
                : 280
              : side === "left"
                ? 360
                : 560,
          );
        }
      }}
    />
  );
  return (
    <Resizable
      className={`workspace-panel ${side}-workspace-panel`}
      size={{ width: "100%", height: "100%" }}
      enable={{
        right: side === "left" && open,
        left: side === "right" && open,
      }}
      handleComponent={side === "left" ? { right: handle } : { left: handle }}
      handleStyles={
        side === "left"
          ? { right: { width: 8, right: -4, zIndex: 10 } }
          : { left: { width: 8, left: -4, zIndex: 10 } }
      }
      onResizeStart={() => {
        start.current = size;
      }}
      onResize={(_event, _direction, _element, delta) =>
        onResize(start.current + delta.width)
      }
    >
      {children}
    </Resizable>
  );
}

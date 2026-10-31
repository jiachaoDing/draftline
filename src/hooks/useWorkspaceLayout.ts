import { useCallback, useEffect, useState } from "react";
import { z } from "zod";

const schema = z.object({
  left: z.number().min(200).max(360).catch(244),
  right: z.number().min(280).max(560).catch(360),
  leftOpen: z.boolean().catch(true),
  rightOpen: z.boolean().catch(true),
});
const defaults = schema.parse({});
const key = "draftline-workspace-layout";

export function useWorkspaceLayout() {
  const [layout, setLayout] = useState(() => {
    try {
      return schema.parse(JSON.parse(localStorage.getItem(key) || "{}"));
    } catch {
      return defaults;
    }
  });
  const [width, setWidth] = useState(window.innerWidth);
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => {
    const resize = () => {
      setWidth(window.innerWidth);
      setMobileOpen(false);
    };
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(layout));
    } catch {
      // Layout remains usable when browser storage is unavailable.
    }
  }, [layout]);
  const left = Math.min(layout.left, Math.max(200, width - 360));
  const right = Math.min(
    layout.right,
    Math.max(280, width - (layout.leftOpen ? left : 0) - 360),
  );
  const setSidebarOpen = useCallback((open: boolean) => {
    if (window.innerWidth <= 700) setMobileOpen(open);
    else setLayout((value) => ({ ...value, leftOpen: open }));
  }, []);
  return {
    layout,
    left,
    right,
    sidebarOpen: width <= 700 ? mobileOpen : layout.leftOpen,
    setSidebarOpen,
    setRightOpen: (open: boolean) =>
      setLayout((value) => ({ ...value, rightOpen: open })),
    resize: (side: "left" | "right", size: number) =>
      setLayout((value) => ({
        ...value,
        [side]: Math.round(
          Math.max(
            side === "left" ? 200 : 280,
            Math.min(side === "left" ? 360 : 560, size),
          ),
        ),
      })),
  };
}

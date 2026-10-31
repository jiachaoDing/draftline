import type SelectionArea from "@viselect/vanilla";
import type { SelectionState } from "./contracts";

/** Serialized into the opaque frame. Keep this function free of module closures. */
export function installSVGSelection(
  svg: SVGSVGElement,
  Selection: typeof SelectionArea,
  send: (type: string, payload: unknown) => void,
  setPanEnabled: (enabled: boolean) => void = () => {},
) {
  let state: SelectionState = { ids: [], rootId: null };
  let locked = false,
    dragging = false,
    additive = false;
  let previous: string[] = [],
    changedIds: string[] = [];
  let pointerId: number | null = null;
  let panStart: { x: number; y: number } | null = null;
  let panMoved = false;
  let touchGesture = false;
  svg.addEventListener("pointerdown", (event) => {
    pointerId = event.pointerId;
  });
  const selector = "g,path,circle,ellipse,rect,line,polygon,polyline,text,use";
  const objects = [
    ...svg.querySelectorAll(
      `#geometry :is(${selector})[id],#dimensions > g[id]`,
    ),
  ].filter((node) => !node.closest("defs,clipPath,mask"));
  const byId = new Map(objects.map((node) => [node.id, node]));
  const overlay = document.createElement("div");
  overlay.className = "svg-selection-overlay";
  overlay.setAttribute("aria-hidden", "true");
  document.body.append(overlay);
  const visible = (node: Element) => {
    const box = node.getBoundingClientRect();
    return (
      box.width + box.height > 0 &&
      getComputedStyle(node).visibility !== "hidden"
    );
  };
  const normalize = (ids: string[]) => {
    const selected = new Set(ids);
    return [...selected].filter((id) => {
      const node = byId.get(id);
      if (!node) return false;
      for (
        let parent = node.parentElement;
        parent;
        parent = parent.parentElement
      )
        if (byId.has(parent.id) && selected.has(parent.id)) return false;
      return true;
    });
  };
  let renderedIds = new Set<string>();
  let refreshFrame: number | undefined;
  const draw = () => {
    if (refreshFrame !== undefined) cancelAnimationFrame(refreshFrame);
    refreshFrame = undefined;
    overlay.replaceChildren();
    const selected = new Set(state.ids);
    for (const id of renderedIds)
      if (!selected.has(id)) byId.get(id)?.removeAttribute("data-selected");
    for (const id of selected)
      if (!renderedIds.has(id))
        byId.get(id)?.setAttribute("data-selected", "true");
    renderedIds = selected;
    const boxes = [
      ...state.ids.map((id) => ({ id, kind: "selected" })),
      ...changedIds.map((id) => ({ id, kind: "changed" })),
      ...(state.rootId ? [{ id: state.rootId, kind: "editing" }] : []),
    ];
    for (const { id, kind } of boxes) {
      const node =
        id === "drawing"
          ? svg
          : byId.get(id) ||
            [...svg.querySelectorAll("[id]")].find(
              (element) => element.id === id,
            );
      if (!node || !visible(node)) continue;
      const box = node.getBoundingClientRect();
      const outline = document.createElement("div");
      outline.className = `svg-object-outline ${kind}`;
      outline.dataset.objectId = id;
      Object.assign(outline.style, {
        left: `${box.left - 2}px`,
        top: `${box.top - 2}px`,
        width: `${box.width + 4}px`,
        height: `${box.height + 4}px`,
      });
      overlay.append(outline);
    }
  };
  const publish = (ids: string[], rootId = state.rootId) => {
    state = { ids: normalize(ids), rootId };
    draw();
    send("selection", state);
  };
  const root = () => (state.rootId ? byId.get(state.rootId) : null);
  const candidates = () =>
    objects.filter((node) => {
      if (!visible(node)) return false;
      const currentRoot = root();
      return currentRoot
        ? node.parentElement === currentRoot
        : node.parentElement?.id === "geometry" ||
            node.parentElement?.id === "dimensions";
    });
  const scopeFor = (node: Element) => {
    let scope = root();
    while (scope && !scope.contains(node))
      scope = byId.get(scope.parentElement?.id || "") || null;
    return scope;
  };
  const target = (event: MouseEvent) => {
    const origin = event.target instanceof Element ? event.target : null;
    let node =
      origin?.closest(`#dimensions > g[id]`) ||
      origin?.closest(`#geometry :is(${selector})[id]`);
    if (!node || !byId.has(node.id) || !visible(node)) return null;
    if (root() === node) return null;
    const currentRoot = scopeFor(node);
    if (event.ctrlKey || event.metaKey) return node;
    while (
      node.parentElement &&
      byId.has(node.parentElement.id) &&
      node.parentElement !== currentRoot
    )
      node = node.parentElement;
    return node;
  };
  svg.addEventListener(
    "pointerdown",
    (event) => {
      if (touchGesture) return;
      const pan = !event.shiftKey;
      setPanEnabled(false);
      panMoved = false;
      panStart = pan ? { x: event.clientX, y: event.clientY } : null;
    },
    true,
  );
  svg.addEventListener("pointermove", (event) => {
    if (
      panStart &&
      Math.hypot(event.clientX - panStart.x, event.clientY - panStart.y) > 5
    ) {
      panMoved = true;
      setPanEnabled(true);
      // Capture only after a drag starts so ordinary clicks retain their
      // original object target instead of being retargeted to the SVG root.
      svg.setPointerCapture(event.pointerId);
      document.body.dataset.panning = "true";
    }
  });
  const endPan = () => {
    setPanEnabled(false);
    panStart = null;
    delete document.body.dataset.panning;
  };
  svg.addEventListener("pointerup", endPan);
  svg.addEventListener("pointercancel", endPan);
  const marquee = new Selection({
    selectables: ["[data-marquee-target]"],
    startAreas: [document.body],
    boundaries: [document.body],
    selectionAreaClass: "svg-marquee",
    behaviour: { startThreshold: 5, intersect: "cover", overlap: "keep" },
    features: { singleTap: { allow: false }, range: false, touch: true },
  });
  marquee.on("beforestart", ({ event }) => {
    if (
      !event?.shiftKey ||
      locked ||
      (event instanceof MouseEvent && (event.ctrlKey || event.metaKey))
    )
      return false;
    dragging = false;
    additive = !!event?.shiftKey;
    previous = additive ? [...state.ids] : [];
    marquee.clearSelection(true, true);
    objects.forEach((node) => node.removeAttribute("data-marquee-target"));
    candidates().forEach((node) =>
      node.setAttribute("data-marquee-target", ""),
    );
  });
  marquee.on("start", () => {
    dragging = true;
    if (pointerId !== null) svg.setPointerCapture(pointerId);
  });
  marquee.on("move", ({ store }) => {
    if (dragging)
      publish([...previous, ...store.selected.map((node) => node.id)]);
  });
  marquee.on("stop", () => {
    if (dragging) {
      publish([...previous, ...marquee.getSelection().map((node) => node.id)]);
      // A drag's synthetic click must not replace the marquee selection.
      setTimeout(() => {
        dragging = false;
      }, 0);
    }
  });
  svg.addEventListener("click", (event) => {
    if (locked || dragging || panMoved) return;
    const node = target(event);
    const ids = node
      ? event.shiftKey
        ? state.ids.includes(node.id)
          ? state.ids.filter((id) => id !== node.id)
          : [...state.ids, node.id]
        : [node.id]
      : event.shiftKey
        ? state.ids
        : [];
    publish(ids, node ? scopeFor(node)?.id || null : state.rootId);
  });
  svg.addEventListener("dblclick", (event) => {
    if (locked || panMoved || dragging) return;
    const node = target(event);
    if (node?.localName === "g" && node.closest("#geometry")) {
      publish([], node.id);
      event.preventDefault();
    }
  });
  const exit = () => {
    const current = root();
    if (current)
      publish(
        [current.id],
        byId.has(current.parentElement?.id || "")
          ? current.parentElement!.id
          : null,
      );
    else publish([]);
  };
  document.addEventListener("keydown", (event) => {
    if (locked || event.isComposing) return;
    const mod = event.ctrlKey || event.metaKey;
    if (event.key === "Escape") {
      event.preventDefault();
      marquee.cancel();
      dragging = false;
      exit();
    } else if (mod && event.key.toLowerCase() === "a") {
      event.preventDefault();
      publish(candidates().map((node) => node.id));
    } else if (mod && event.key.toLowerCase() === "g") {
      event.preventDefault();
      send("command", event.shiftKey ? "ungroup" : "group");
    } else if (mod && event.key.toLowerCase() === "z") {
      event.preventDefault();
      send("command", event.shiftKey ? "redo" : "undo");
    } else if (
      event.key === "Enter" &&
      state.ids.length === 1 &&
      byId.get(state.ids[0])?.localName === "g"
    ) {
      event.preventDefault();
      publish([], state.ids[0]);
    }
  });
  return {
    setTouchGesture: (active: boolean) => {
      touchGesture = active;
      panStart = null;
      panMoved = true;
      setPanEnabled(false);
      if (active) {
        marquee.cancel();
        dragging = false;
      }
    },
    visibilityChanged: () => {
      const ids = state.ids.filter((id) => {
        const node = byId.get(id);
        return node && visible(node);
      });
      const currentRoot = root();
      const rootId = currentRoot && visible(currentRoot) ? state.rootId : null;
      if (ids.length !== state.ids.length || rootId !== state.rootId)
        publish(ids, rootId);
      else draw();
    },
    command: (value: string) => {
      if (locked) return;
      if (value === "select-all") publish(candidates().map((node) => node.id));
      else if (value === "escape") {
        marquee.cancel();
        dragging = false;
        exit();
      } else send("command", value);
    },
    refresh: () => {
      if (refreshFrame === undefined)
        refreshFrame = requestAnimationFrame(draw);
    },
    setLocked: (value: boolean) => {
      locked = value;
      if (locked) {
        marquee.cancel();
        dragging = false;
      }
    },
    setChanges: (ids: string[]) => {
      changedIds = ids;
      draw();
    },
    setSelection: (value: SelectionState) => {
      state = {
        ids: normalize(value.ids),
        rootId: value.rootId && byId.has(value.rootId) ? value.rootId : null,
      };
      draw();
    },
  };
}

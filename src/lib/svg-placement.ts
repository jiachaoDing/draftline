import type { z } from "zod";
import type { placeSvgSchema } from "./resource-contracts";

export type SvgPlacement = z.infer<typeof placeSvgSchema> & {
  assetWidth: number;
  assetHeight: number;
};

export function placeMeasuredSvg(input: SvgPlacement) {
  const root = document.querySelector<SVGSVGElement>("svg#drawing")!;
  const group = document.getElementById(
    input.object_id,
  ) as unknown as SVGGElement;
  const parent = group.parentNode!;
  const asset = group.querySelector("svg")!;
  const content = input.bounds === "content";
  const fail = (reason: string): never => {
    throw new Error(
      `SVG content measurement: ${reason} Use an explicit target_id or canvas bounds when appropriate.`,
    );
  };
  if (content) {
    for (
      let ancestor = group.parentElement;
      ancestor;
      ancestor = ancestor.parentElement
    ) {
      const style = getComputedStyle(ancestor);
      if (
        style.display === "none" ||
        Number(style.opacity) === 0 ||
        style.filter !== "none" ||
        style.maskImage !== "none" ||
        style.clipPath !== "none"
      )
        fail(
          "The placement parent hides or modifies the artwork with compositing effects.",
        );
    }
  }
  if (input.target_id) {
    const target = [...asset.querySelectorAll("[id]")].find(
      (node) => node.id === input.target_id,
    );
    if (!target || target.closest("defs,clipPath,mask,pattern,marker"))
      fail("target_id must identify a rendered object or group.");
    for (const node of asset.querySelectorAll("*")) {
      if (node.closest("defs,clipPath,mask,pattern,marker")) continue;
      if (node !== target && !target!.contains(node) && !node.contains(target!))
        node.setAttribute("display", "none");
    }
  }
  const measure = group.cloneNode(true) as SVGGElement;
  measure.removeAttribute("transform");
  group.remove();
  root.append(measure);
  const contains = (
    outer: { x: number; y: number; width: number; height: number },
    inner: { x: number; y: number; width: number; height: number },
  ) =>
    inner.x >= outer.x - 1e-7 &&
    inner.y >= outer.y - 1e-7 &&
    inner.x + inner.width <= outer.x + outer.width + 1e-7 &&
    inner.y + inner.height <= outer.y + outer.height + 1e-7;
  let box = { x: 0, y: 0, width: input.assetWidth, height: input.assetHeight };
  try {
    if (content) {
      const definitions = "defs,clipPath,mask,pattern,marker,symbol";
      const shapes = "path,rect,circle,ellipse,line,polyline,polygon,text,use";
      const references = new Map(
        [...measure.querySelectorAll("[id]")].map((node) => [node.id, node]),
      );
      const colorCanvas = document.createElement("canvas");
      colorCanvas.width = colorCanvas.height = 1;
      const colorContext = colorCanvas.getContext("2d")!;
      const colors = new Map<string, number>();
      const alpha = (paint: string) => {
        if (paint === "none") return 0;
        if (paint.includes("url(")) return 255;
        if (!colors.has(paint)) {
          colorContext.clearRect(0, 0, 1, 1);
          colorContext.fillStyle = paint;
          colorContext.fillRect(0, 0, 1, 1);
          colors.set(paint, colorContext.getImageData(0, 0, 1, 1).data[3]);
        }
        return colors.get(paint)!;
      };
      const painted: SVGGraphicsElement[] = [];
      for (const node of [
        measure,
        ...measure.querySelectorAll<SVGGraphicsElement>("*"),
      ]) {
        if (!measure.contains(node) || node.closest(definitions)) continue;
        const style = getComputedStyle(node);
        if (style.display === "none" || Number(style.opacity) === 0) {
          node.remove();
          continue;
        }
        if (!node.matches(shapes)) continue;
        if (
          style.visibility !== "visible" ||
          (node.localName === "line" && style.stroke === "none") ||
          ((alpha(style.fill) === 0 || Number(style.fillOpacity) === 0) &&
            (alpha(style.stroke) === 0 || Number(style.strokeOpacity) === 0))
        ) {
          node.remove();
          continue;
        }
        if (node.matches("text,use"))
          fail(
            "Text and use instances require canvas bounds or a path target.",
          );
        for (const paint of [style.fill, style.stroke]) {
          if (paint.includes("url(")) {
            const reference = paint.match(/#([\w.-]+)["']?\)$/)?.[1];
            const gradient = references.get(reference || "");
            if (
              !gradient ||
              !gradient.matches("linearGradient,radialGradient") ||
              gradient.hasAttribute("href") ||
              !gradient.querySelector("stop") ||
              [...gradient.querySelectorAll("stop")].some(
                (stop) =>
                  Number(getComputedStyle(stop).stopOpacity) !== 1 ||
                  alpha(getComputedStyle(stop).stopColor) !== 255,
              )
            )
              fail(
                "Patterns and transparent or indirect gradients require canvas bounds.",
              );
          }
        }
        painted.push(node);
      }
      if (!painted.length) fail("No visible measurable artwork.");
      for (const node of [
        measure,
        ...measure.querySelectorAll<SVGGraphicsElement>("*"),
      ]) {
        if (node.closest(definitions)) continue;
        const style = getComputedStyle(node);
        if (
          style.filter !== "none" ||
          style.maskImage !== "none" ||
          node.hasAttribute("mask") ||
          [style.markerStart, style.markerMid, style.markerEnd].some(
            (value) => value !== "none",
          )
        )
          fail(
            "Filters, masks and markers do not have reliable geometric painted bounds.",
          );
        if (style.vectorEffect !== "none")
          fail("Non-scaling strokes require canvas bounds.");
      }
      for (const node of painted) {
        const style = getComputedStyle(node);
        if (
          alpha(style.stroke) === 0 ||
          Number(style.strokeOpacity) === 0 ||
          parseFloat(style.strokeWidth) === 0
        )
          continue;
        const matrix = measure
          .getScreenCTM()!
          .inverse()
          .multiply(node.getScreenCTM()!);
        if (
          !node.matches("rect,circle,ellipse") ||
          Math.abs(matrix.b) > 1e-9 ||
          Math.abs(matrix.c) > 1e-9 ||
          style.strokeDasharray !== "none"
        )
          fail(
            "This stroke cannot be measured reliably; supported strokes are solid axis-aligned rect/circle/ellipse.",
          );
        const bounds = node.getBBox();
        const padding = parseFloat(style.strokeWidth) / 2;
        if (!Number.isFinite(padding) || !/^[\d.]+px$/.test(style.strokeWidth))
          fail("Stroke width must resolve to an absolute length.");
        const extent = document.createElementNS(
          root.namespaceURI,
          "rect",
        ) as SVGRectElement;
        extent.setAttribute("x", String(bounds.x - padding));
        extent.setAttribute("y", String(bounds.y - padding));
        extent.setAttribute("width", String(bounds.width + padding * 2));
        extent.setAttribute("height", String(bounds.height + padding * 2));
        extent.setAttribute(
          "transform",
          `matrix(${matrix.a} ${matrix.b} ${matrix.c} ${matrix.d} ${matrix.e} ${matrix.f})`,
        );
        measure.append(extent);
      }
      box = measure.getBBox();
      if (
        ![box.x, box.y, box.width, box.height].every(Number.isFinite) ||
        box.width <= 0 ||
        box.height <= 0
      )
        fail("No positive finite artwork bounds.");
      const projected = (
        node: SVGGraphicsElement,
        bounds: SVGRect,
        allowRotation = false,
      ) => {
        const matrix = measure
          .getScreenCTM()!
          .inverse()
          .multiply(node.getScreenCTM()!);
        if (
          !allowRotation &&
          (Math.abs(matrix.b) > 1e-9 || Math.abs(matrix.c) > 1e-9)
        )
          fail("Rotated clipping and viewports require canvas bounds.");
        const corners = [
          [bounds.x, bounds.y],
          [bounds.x + bounds.width, bounds.y],
          [bounds.x, bounds.y + bounds.height],
          [bounds.x + bounds.width, bounds.y + bounds.height],
        ].map(([cornerX, cornerY]) =>
          new DOMPoint(cornerX, cornerY).matrixTransform(matrix),
        );
        const left = Math.min(...corners.map((point) => point.x));
        const top = Math.min(...corners.map((point) => point.y));
        return new DOMRect(
          left,
          top,
          Math.max(...corners.map((point) => point.x)) - left,
          Math.max(...corners.map((point) => point.y)) - top,
        );
      };
      for (const node of measure.querySelectorAll<SVGGraphicsElement>("*")) {
        if (node.closest(definitions)) continue;
        const style = getComputedStyle(node);
        if (style.clipPath !== "none") {
          const reference = node
            .getAttribute("clip-path")
            ?.match(/^url\(\s*#([\w.-]+)\s*\)$/)?.[1];
          const clip = references.get(reference || "");
          const rect = clip?.firstElementChild as SVGRectElement | null;
          if (
            !clip ||
            clip.localName !== "clipPath" ||
            getComputedStyle(clip).display === "none" ||
            clip.children.length !== 1 ||
            rect?.localName !== "rect" ||
            clip.getAttribute("clipPathUnits") === "objectBoundingBox" ||
            clip.hasAttribute("transform") ||
            rect.hasAttribute("transform") ||
            rect.hasAttribute("rx") ||
            rect.hasAttribute("ry") ||
            getComputedStyle(rect).display === "none" ||
            getComputedStyle(rect).visibility !== "visible" ||
            rect.hasAttribute("clip-path") ||
            rect.hasAttribute("mask") ||
            !contains(projected(node, rect.getBBox()), box)
          )
            fail(
              "Only enclosing, unrounded rectangular userSpaceOnUse clips are measurable. Intersecting clips require canvas bounds.",
            );
        }
        if (node instanceof SVGSVGElement && style.overflow !== "visible") {
          if (
            node.preserveAspectRatio.baseVal.align !== 1 &&
            node.preserveAspectRatio.baseVal.meetOrSlice === 2
          )
            fail("Slice viewports require canvas bounds.");
          const viewport =
            node.viewBox.baseVal.width > 0
              ? node.viewBox.baseVal
              : new DOMRect(
                  0,
                  0,
                  node.width.baseVal.value,
                  node.height.baseVal.value,
                );
          if (viewport.width <= 0 || !contains(projected(node, viewport), box))
            fail("Artwork intersects a clipped SVG viewport.");
        }
      }
      if (!input.target_id && painted.length > 1) {
        const viewport = measure.querySelector("svg")!;
        const canvas = projected(viewport, viewport.viewBox.baseVal);
        if (
          painted.some(
            (node) =>
              getComputedStyle(node).fill !== "none" &&
              contains(projected(node, node.getBBox(), true), canvas),
          )
        )
          fail(
            "A canvas-covering background and artwork are ambiguous. Select the artwork using its original target_id.",
          );
      }
    }
  } finally {
    measure.remove();
    parent.appendChild(group);
  }
  const scale = input.width / box.width;
  const center = input.anchor === "center";
  const anchorX = content
    ? box.x + (center ? box.width / 2 : 0)
    : center
      ? box.width / 2
      : 0;
  const anchorY = content
    ? box.y + (center ? box.height / 2 : 0)
    : center
      ? box.height / 2
      : 0;
  const matrix = root
    .createSVGMatrix()
    .translate(input.x, input.y)
    .rotate(input.rotation || 0)
    .scale(scale)
    .translate(-anchorX, -anchorY);
  const fit = input.fit_box || (content ? root.viewBox.baseVal : undefined);
  if (fit) {
    const corners = [
      [box.x, box.y],
      [box.x + box.width, box.y],
      [box.x, box.y + box.height],
      [box.x + box.width, box.y + box.height],
    ].map(([cornerX, cornerY]) =>
      new DOMPoint(cornerX, cornerY).matrixTransform(matrix),
    );
    if (
      corners.some(
        (point) =>
          point.x < fit.x - 1e-6 ||
          point.y < fit.y - 1e-6 ||
          point.x > fit.x + fit.width + 1e-6 ||
          point.y > fit.y + fit.height + 1e-6,
      )
    )
      throw new Error(
        "The SVG at the requested width and position does not fit fit_box/the drawing canvas. Ask for a different width or placement; it was not shrunk.",
      );
  }
  const parentMatrix = root
    .getScreenCTM()!
    .inverse()
    .multiply((parent as SVGGraphicsElement).getScreenCTM()!);
  const local = parentMatrix.inverse().multiply(matrix);
  if (
    ![local.a, local.b, local.c, local.d, local.e, local.f].every(
      Number.isFinite,
    )
  )
    throw new Error("The placement parent transform is singular or invalid.");
  group.setAttribute(
    "transform",
    `matrix(${local.a} ${local.b} ${local.c} ${local.d} ${local.e} ${local.f})`,
  );
}

import { jsPDF } from "jspdf";
import { svg2pdf } from "svg2pdf.js";
import { exportSVG } from "./drawing";
import { preparePdfFonts } from "./pdf-fonts";
import { composePdfLayers } from "./pdf-layers";

// svg2pdf scales every marker by stroke width, including userSpaceOnUse markers.
// Normalize private definitions so dimension arrowheads keep their SVG size.
function normalizeMarkers(svg: SVGSVGElement) {
  for (const node of svg.querySelectorAll("path,line,polyline,polygon")) {
    const style = getComputedStyle(node);
    const stroke = parseFloat(style.strokeWidth);
    if (!stroke || stroke === 1) continue;
    for (const name of ["marker-start", "marker-mid", "marker-end"]) {
      const id = style.getPropertyValue(name).match(/#([^"')]+)["']?\)/)?.[1];
      const marker = id ? svg.querySelector(`[id="${CSS.escape(id)}"]`) : null;
      if (marker?.getAttribute("markerUnits") !== "userSpaceOnUse") continue;
      const copy = marker.cloneNode(true) as SVGMarkerElement;
      let copyId = `${id}-pdf`;
      while (svg.querySelector(`[id="${CSS.escape(copyId)}"]`))
        copyId += "-copy";
      copy.id = copyId;
      for (const attr of ["refX", "refY", "markerWidth", "markerHeight"])
        copy.setAttribute(
          attr,
          String(
            parseFloat(
              marker.getAttribute(attr) || (attr.startsWith("ref") ? "0" : "3"),
            ) / stroke,
          ),
        );
      const viewBox = marker.getAttribute("viewBox");
      if (viewBox)
        copy.setAttribute(
          "viewBox",
          viewBox
            .trim()
            .split(/[\s,]+/)
            .map((v) => Number(v) / stroke)
            .join(" "),
        );
      const group = document.createElementNS(svg.namespaceURI, "g");
      group.setAttribute("transform", `scale(${1 / stroke})`);
      group.append(...copy.childNodes);
      copy.append(group);
      marker.parentNode!.appendChild(copy);
      node.setAttribute(name, `url(#${copyId})`);
    }
  }
}

/** Export canonical geometry as PDF paths at its original millimeter scale. */
export async function exportPDF(source: string): Promise<Uint8Array> {
  const svg = document.importNode(
    new DOMParser().parseFromString(exportSVG(source), "image/svg+xml")
      .documentElement,
    true,
  ) as unknown as SVGSVGElement;
  const width = parseFloat(svg.getAttribute("width")!);
  const height = parseFloat(svg.getAttribute("height")!);
  const pointsPerMM = 72 / 25.4;
  // jsPDF's page limit must not silently change the drawing's physical scale.
  if (Math.max(width, height) * pointsPerMM > 14400)
    throw new Error("The drawing exceeds the PDF page size limit.");
  const host = document.createElement("div");
  host.style.cssText =
    "position:fixed;left:-100000px;top:0;pointer-events:none";
  host.setAttribute("aria-hidden", "true");
  host.append(svg);
  document.body.append(host);
  try {
    normalizeMarkers(svg);
    svg.setAttribute("width", String(width * pointsPerMM));
    svg.setAttribute("height", String(height * pointsPerMM));
    const pdf = new jsPDF({
      unit: "pt",
      format: [width * pointsPerMM, height * pointsPerMM],
      orientation: width > height ? "landscape" : "portrait",
      compress: true,
      floatPrecision: 16,
      putOnlyUsedFonts: true,
    });
    await preparePdfFonts(svg, pdf);
    const layers = [
      ...svg.querySelectorAll<SVGGElement>(":scope > svg > g[data-layer]"),
    ];
    const displays = layers.map((layer) => layer.getAttribute("display"));
    for (let index = 0; index < layers.length; index++) {
      if (index)
        pdf.addPage(
          [width * pointsPerMM, height * pointsPerMM],
          width > height ? "landscape" : "portrait",
        );
      layers.forEach((layer, i) => {
        if (i !== index) layer.setAttribute("display", "none");
        else if (displays[i] === null) layer.removeAttribute("display");
        else layer.setAttribute("display", displays[i]!);
      });
      await svg2pdf(svg, pdf, {
        loadExternalStyleSheets: false,
        loadImages: false,
      });
    }
    return await composePdfLayers(
      pdf.output("arraybuffer"),
      layers.map((layer) => layer.id),
    );
  } finally {
    host.remove();
  }
}

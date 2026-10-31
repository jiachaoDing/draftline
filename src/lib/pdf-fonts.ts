import type { jsPDF } from "jspdf";

type FontResource = { binary: string; face: FontFace };
const family = "Draftline PDF Sans";
const cached: Partial<Record<"normal" | "bold", Promise<FontResource>>> = {};

function loadFont(style: "normal" | "bold"): Promise<FontResource> {
  return (cached[style] ??= (async () => {
    const { default: compressed } =
      style === "bold"
        ? await import("../../third_party/pdf-fonts/NotoSansSC-Bold.base64.txt?raw")
        : await import("../../third_party/pdf-fonts/NotoSansSC-Regular.base64.txt?raw");
    const packed = Uint8Array.from(atob(compressed), (c) => c.charCodeAt(0));
    const buffer = await new Response(
      new Blob([packed]).stream().pipeThrough(new DecompressionStream("gzip")),
    ).arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 32768)
      binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
    const face = await new FontFace(family, buffer, {
      weight: style === "bold" ? "700" : "400",
    }).load();
    document.fonts.add(face);
    return { binary, face };
  })().catch((error) => {
    delete cached[style];
    throw error;
  }));
}

/** Self-hosted font assets; jsPDF embeds only glyphs used in this document. */
export async function preparePdfFonts(
  svg: SVGSVGElement,
  pdf: jsPDF,
): Promise<void> {
  const nodes = [...svg.querySelectorAll("text,tspan,textPath")];
  const styles = new Set<"normal" | "bold">();
  for (const node of nodes) {
    const bold = parseFloat(getComputedStyle(node).fontWeight) >= 600;
    styles.add(bold ? "bold" : "normal");
    node.setAttribute("font-family", family);
    node.setAttribute("font-weight", bold ? "bold" : "normal");
    node.setAttribute("font-style", "normal");
  }
  for (const style of styles) {
    const { binary } = await loadFont(style);
    const file = `Draftline-${style}.ttf`;
    pdf.addFileToVFS(file, binary);
    pdf.addFont(file, family, style);
  }
}

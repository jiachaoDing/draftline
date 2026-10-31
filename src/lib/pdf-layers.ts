import {
  PDFDocument,
  PDFName,
  PDFOperator,
  PDFOperatorNames,
  PDFString,
  PrintScaling,
} from "pdf-lib";

/** Each rendered SVG layer becomes a named PDF optional-content group. */
export async function composePdfLayers(
  bytes: ArrayBuffer,
  names: string[],
): Promise<Uint8Array> {
  const rendered = await PDFDocument.load(bytes);
  const pdf = await PDFDocument.create();
  const { width, height } = rendered.getPage(0).getSize();
  const page = pdf.addPage([width, height]);
  const embedded = await pdf.embedPages(rendered.getPages());
  const properties = pdf.context.obj({});
  const groups = names.map((name, index) => {
    const group = pdf.context.register(
      pdf.context.obj({ Type: "OCG", Name: PDFString.of(name) }),
    );
    const key = PDFName.of(`Layer${index}`);
    properties.set(key, group);
    page.pushOperators(
      PDFOperator.of(PDFOperatorNames.BeginMarkedContentSequence, [
        PDFName.of("OC"),
        key,
      ]),
    );
    page.drawPage(embedded[index], { x: 0, y: 0, width, height });
    page.pushOperators(PDFOperator.of(PDFOperatorNames.EndMarkedContent));
    return group;
  });
  page.node.Resources()!.set(PDFName.of("Properties"), properties);
  pdf.catalog.set(
    PDFName.of("OCProperties"),
    pdf.context.obj({
      OCGs: groups,
      D: { Order: groups, ON: groups, BaseState: "ON" },
    }),
  );
  pdf.catalog.getOrCreateViewerPreferences().setPrintScaling(PrintScaling.None);
  return pdf.save();
}

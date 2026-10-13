// Load the browser formatter only when drawing source needs formatting.
export async function formatDrawingSource(source: string): Promise<string> {
  const [prettier, html, babel, estree, postcss] = await Promise.all([
    import("prettier/standalone"),
    import("prettier/plugins/html"),
    import("prettier/plugins/babel"),
    import("prettier/plugins/estree"),
    import("prettier/plugins/postcss"),
  ]);
  return prettier.format(source, {
    parser: "html",
    plugins: [html, babel, estree, postcss],
    tabWidth: 2,
    useTabs: false,
    printWidth: 80,
    endOfLine: "lf",
  });
}

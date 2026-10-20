import { config, Helper } from "dxf";

config.verbose = false;
// Parser diagnostics may contain source data; expose only bounded structured feedback.
console.error = () => {};
self.onmessage = (event: MessageEvent<{ text: string; preview: boolean }>) => {
  try {
    const helper = new Helper(event.data.text);
    const entities = helper.parsed.entities;
    if (entities.length > 50000) throw new Error("Too many entities");
    const types: Record<string, number> = {};
    for (const entity of entities)
      types[entity.type] = (types[entity.type] || 0) + 1;
    const svg = event.data.preview ? helper.toSVG() : undefined;
    if (svg && svg.length > 4 * 1024 * 1024)
      throw new Error("Preview too large");
    self.postMessage({
      ok: true,
      entities: entities.length,
      entityTypes: types,
      svg,
    });
  } catch {
    self.postMessage({
      ok: false,
      error:
        "DXF could not be parsed or exceeds preview complexity limits. Use bounded text access instead.",
    });
  }
};

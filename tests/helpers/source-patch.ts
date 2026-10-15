/** Provider fixture authors a real contextual Codex patch from inspection output. */
export function radiusPatch(html: string, id: string, radius: string) {
  const lines = html.split("\n");
  const start = lines.findIndex((line) => line.includes(`id="${id}"`));
  if (start < 0) throw new Error(`Fixture could not inspect ${id}`);
  let end = start;
  while (!lines[end].includes("/>")) end++;
  const block = lines.slice(start, end + 1);
  const body = block
    .flatMap((line) =>
      /\br="/.test(line)
        ? [`-${line}`, `+${line.replace(/r="[^"]+"/, `r="${radius}"`)}`]
        : [` ${line}`],
    )
    .join("\n");
  return `*** Begin Patch\n*** Update File: drawing.html\n@@\n${body}\n*** End Patch`;
}
export function inspectedHTML(text: string) {
  const lines = new Map<number, string>();
  for (const line of text.split("\n")) {
    const match = /^L(\d+): (.*)$/.exec(line);
    if (match) lines.set(Number(match[1]), match[2]);
  }
  return [...lines]
    .sort(([a], [b]) => a - b)
    .map(([, line]) => line)
    .join("\n");
}

import { describe, expect, it } from "vitest";
import { EXAMPLE } from "../src/lib/example";
import { drawingContext } from "../src/lib/ai-workflow";
import { runDrawingAgent } from "../src/lib/drawing-agent";
import { DrawingToolSession } from "../src/lib/drawing-tool-session";
import { cleanDrawing, sanitizeSVG, serialize } from "../src/lib/drawing";
import { formatDrawingSource } from "../src/lib/format-source";
import { readSource, searchSource } from "../src/lib/source-inspection";
import type { DrawingRequest, DrawingResult } from "../src/lib/contracts";
import { inspectedHTML, radiusPatch } from "./helpers/source-patch";
import { projectSchema, newProject } from "../src/lib/projects";
import { pushHistory } from "../src/lib/history";

const config = {
  baseURL: "https://example.com/v1",
  apiKey: "private-key",
  model: "test",
};
const validate = async (html: string) => {
  const svg = new DOMParser()
    .parseFromString(html, "text/html")
    .querySelector("svg");
  if (!svg) throw new Error("Missing SVG");
  return cleanDrawing(serialize(svg));
};
const call = (id: string, name: string, args: unknown) => ({
  id,
  name,
  arguments: JSON.stringify(args),
});
async function session(selectedId?: string, current = () => true) {
  return new DrawingToolSession(
    {
      path: "drawing.html",
      revision: "base",
      html: await formatDrawingSource(EXAMPLE.html),
    },
    EXAMPLE,
    selectedId,
    validate,
    current,
  );
}
const signal = () => new AbortController().signal;

describe("versioned virtual source tools", () => {
  it("inspects selected elements, surrounding lines, associated dimensions and literal search", async () => {
    const tools = await session();
    const read = readSource(tools.source, 1, 30, "hole-top-left");
    expect(read.text).toContain('id="hole-top-left"');
    expect(read.text).toContain('id="dim-hole"');
    expect(read.text).toMatch(/L\d+: /);
    expect(searchSource(tools.source, 'id="plate-outline"').matches).toBe(1);
    expect(searchSource(tools.source, "[a-z]").matches).toBe(0);
    const denied = await tools.execute(
      call("denied", "read_source", { file_path: "../.env" }),
      signal(),
    );
    expect(JSON.parse(denied).ok).toBe(false);
  });
  it("rejects stale/uninspected revisions and invalid SVG atomically", async () => {
    const tools = await session();
    const before = structuredClone(tools.source);
    const patch = radiusPatch(before.html, "hole-top-left", "7");
    expect(
      JSON.parse(
        await tools.execute(
          call("a", "apply_patch", { revision: "base", patch }),
          signal(),
        ),
      ).error,
    ).toContain("Read or search");
    await tools.execute(
      call("b", "read_source", { file_path: "drawing.html" }),
      signal(),
    );
    expect(
      JSON.parse(
        await tools.execute(
          call("c", "apply_patch", { revision: "stale", patch }),
          signal(),
        ),
      ).error,
    ).toContain("Revision conflict");
    const invalid = `*** Begin Patch\n*** Update File: drawing.html\n@@\n-      width="164mm"\n+      width="165mm"\n*** End Patch`;
    expect(
      JSON.parse(
        await tools.execute(
          call("d", "apply_patch", { revision: "base", patch: invalid }),
          signal(),
        ),
      ).error,
    ).toContain("scale");
    expect(tools.source).toEqual(before);
    expect(tools.drawing).toBe(EXAMPLE);
    expect(
      JSON.parse(
        await tools.execute(
          call("e", "apply_patch", { revision: "base", patch }),
          signal(),
        ),
      ).ok,
    ).toBe(true);
    expect(tools.source.revision).not.toBe("base");
  });
  it("preserves unrelated elements and rejects selected-scope violations and ID removal", async () => {
    const tools = await session("hole-top-left");
    const before = tools.source.html;
    await tools.execute(
      call("read", "read_source", { file_path: "drawing.html" }),
      signal(),
    );
    const patch = radiusPatch(before, "hole-top-right", "9");
    expect(
      JSON.parse(
        await tools.execute(
          call("bad", "apply_patch", { revision: "base", patch }),
          signal(),
        ),
      ).error,
    ).toContain("unrelated");
    expect(tools.source.html).toBe(before);
    const good = JSON.parse(
      await tools.execute(
        call("good", "apply_patch", {
          revision: "base",
          patch: radiusPatch(before, "hole-top-left", "7"),
        }),
        signal(),
      ),
    );
    expect(good, JSON.stringify(good)).toHaveProperty("ok", true);
    const svg = sanitizeSVG(tools.drawing.svg);
    expect(svg.querySelector("#hole-top-left")!.getAttribute("r")).toBe("7");
    for (const id of [
      "hole-top-right",
      "hole-bottom-left",
      "plate-outline",
      "arrow",
    ])
      expect(
        svg
          .querySelector(`#${id}`)!
          .isEqualNode(sanitizeSVG(EXAMPLE.svg).querySelector(`#${id}`)),
      ).toBe(true);
    const changed = structuredClone(tools.source);
    await tools.execute(
      call("read2", "read_source", { file_path: "drawing.html" }),
      signal(),
    );
    const remove = `*** Begin Patch\n*** Update File: drawing.html\n@@\n-      id="hole-top-left"\n+      id="new-id"\n*** End Patch`;
    const result = JSON.parse(
      await tools.execute(
        call("remove", "apply_patch", {
          revision: changed.revision,
          patch: remove,
        }),
        signal(),
      ),
    );
    expect(result.ok).toBe(false);
    expect(tools.source).toEqual(changed);
  });
  it("rejects a committed revision change during asynchronous validation", async () => {
    let current = true;
    const tools = await session(undefined, () => current);
    await tools.execute(
      call("read", "read_source", { file_path: "drawing.html" }),
      signal(),
    );
    // The validator finishes, then the coordinator's current revision guard runs.
    const result = tools.execute(
      call("patch", "apply_patch", {
        revision: "base",
        patch: radiusPatch(tools.source.html, "hole-top-left", "7"),
      }),
      signal(),
    );
    current = false;
    expect(JSON.parse(await result).ok).toBe(false);
    expect(tools.source.revision).toBe("base");
  });
});

describe("inspect → patch → feedback → retry agent loop", () => {
  it("recovers from matching errors, sequences batched calls and commits one synchronized revision", async () => {
    const requests: DrawingRequest[] = [];
    const request = async (input: DrawingRequest): Promise<DrawingResult> => {
      requests.push(input);
      const last = input.agentTurns.at(-1);
      if (!last)
        return {
          kind: "tool_calls",
          content: "Inspecting",
          calls: [
            call("read", "read_source", {
              file_path: "drawing.html",
              element_id: "hole-top-left",
              limit: 100,
            }),
            call("search", "search_source", {
              file_path: "drawing.html",
              query: "4 × Ø10",
            }),
          ],
        };
      if (last.calls[0].id === "read")
        return {
          kind: "tool_calls",
          content: "",
          calls: [
            call("bad", "apply_patch", {
              revision: input.source!.revision,
              patch:
                "*** Begin Patch\n*** Update File: drawing.html\n@@\n-missing line\n+fixed\n*** End Patch",
            }),
          ],
        };
      if (last.calls[0].id === "bad") {
        expect(JSON.parse(last.results[0]).error).toContain(
          "Failed to find expected lines",
        );
        return {
          kind: "tool_calls",
          content: "Retrying",
          calls: [
            call("retry-read", "read_source", {
              file_path: "drawing.html",
              element_id: "hole-top-left",
              limit: 100,
            }),
          ],
        };
      }
      if (last.calls[0].id === "retry-read")
        return {
          kind: "tool_calls",
          content: "",
          calls: [
            call("good", "apply_patch", {
              revision: input.source!.revision,
              patch: radiusPatch(
                inspectedHTML(JSON.parse(last.results[0]).text),
                "hole-top-left",
                "7",
              ),
            }),
          ],
        };
      expect(JSON.parse(last.results[0]), last.results[0]).toHaveProperty(
        "ok",
        true,
      );
      return { kind: "message", message: "Updated the selected hole to Ø14." };
    };
    const outcome = await runDrawingAgent({
      context: drawingContext(
        "Resize",
        [],
        EXAMPLE,
        undefined,
        "hole-top-left",
      ),
      config,
      drawing: EXAMPLE,
      signal: signal(),
      request,
      validate,
      isCurrent: () => true,
      onDelta: () => {},
      onRound: () => {},
    });
    expect(requests).toHaveLength(5);
    expect(outcome.drawing?.svg).toContain('r="7"');
    expect(JSON.stringify(outcome.context)).not.toContain(config.apiKey);
    expect(outcome.drawing?.html).toContain(outcome.drawing!.svg);
    const history = pushHistory(
      { items: [EXAMPLE], index: 0 },
      outcome.drawing!,
    );
    const restored = projectSchema.parse({ ...newProject(), history }).history;
    expect(restored.items[restored.index]?.svg).toBe(outcome.drawing?.svg);
    expect(restored.items[0]?.svg).toContain('r="5"');
  });
  it("discards staged successes on provider failure, cancellation and exhausted tool budget", async () => {
    for (const failure of ["provider", "cancel", "budget"]) {
      const controller = new AbortController();
      let rounds = 0;
      const original = structuredClone(EXAMPLE);
      const request = async (input: DrawingRequest): Promise<DrawingResult> => {
        rounds++;
        if (rounds === 1)
          return {
            kind: "tool_calls",
            content: "",
            calls: [
              call("read", "read_source", {
                file_path: "drawing.html",
                limit: 200,
              }),
            ],
          };
        if (rounds === 2)
          return {
            kind: "tool_calls",
            content: "",
            calls: [
              call("patch", "apply_patch", {
                revision: input.source!.revision,
                patch: radiusPatch(input.source!.html, "hole-top-left", "7"),
              }),
            ],
          };
        if (failure === "provider") throw new Error("Provider failed");
        if (failure === "cancel") controller.abort();
        return {
          kind: "tool_calls",
          content: "",
          calls: [
            call(`read-${rounds}`, "read_source", {
              file_path: "drawing.html",
            }),
          ],
        };
      };
      await expect(
        runDrawingAgent({
          context: drawingContext("Resize", [], EXAMPLE),
          config,
          drawing: EXAMPLE,
          signal: controller.signal,
          request,
          validate,
          isCurrent: () => true,
          onDelta: () => {},
          onRound: () => {},
        }),
      ).rejects.toThrow();
      expect(EXAMPLE).toEqual(original);
    }
  });
});

import { describe, expect, it } from "vitest";
import { parseAttachment } from "../src/lib/attachments";
import {
  projectResources,
  resourceMetadata,
  resourceText,
} from "../src/lib/resources";
import { ResourceToolSession } from "../src/lib/resource-tool-session";
import { DrawingToolSession } from "../src/lib/drawing-tool-session";
import { cleanDrawing, sanitizeSVG, serialize } from "../src/lib/drawing";
import { runDrawingAgent } from "../src/lib/drawing-agent";
import { drawingContext } from "../src/lib/ai-workflow";
import { EXAMPLE } from "../src/lib/example";
import { projectSchema, newProject } from "../src/lib/projects";
import { reusableSvg, sanitizeResourceSvg } from "../src/lib/svg-resource";
import type { AgentCall } from "../src/lib/agent-contracts";
import type { DrawingRequest, DrawingResult } from "../src/lib/contracts";
import { placeSvgSchema } from "../src/lib/resource-contracts";

const logo = `<svg xmlns="http://www.w3.org/2000/svg" width="100px" height="50px" viewBox="10 20 100 50"><style>.shape{fill:url(#paint);stroke:red}#mark{stroke:blue}</style><defs><linearGradient id="paint"><stop offset="0" stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient><clipPath id="cut"><rect x="10" y="20" width="100" height="50"/></clipPath></defs><g clip-path="url(#cut)"><path id="mark" class="shape" d="M10 20L110 20L60 70Z"/><use href="#mark" opacity=".2"/></g></svg>`;
const item = {
  id: "logo",
  name: "logo.svg",
  type: "svg" as const,
  size: logo.length,
  text: logo,
};
const call = (name: string, args: unknown, id = name): AgentCall => ({
  name,
  id,
  arguments: JSON.stringify(args),
});
const signal = () => new AbortController().signal;
const validate = async (html: string) =>
  cleanDrawing(
    serialize(
      new DOMParser().parseFromString(html, "text/html").querySelector("svg")!,
    ),
  );
const config = {
  baseURL: "https://example.com/v1",
  apiKey: "private-key",
  model: "test",
};

describe("project resource access", () => {
  it("preserves raw text that resembles an attachment envelope and handles names with line breaks", async () => {
    const text =
      '<attachment name="original">\nExact original text\n</attachment>';
    const resource = await parseAttachment(
      new File([text], "a\nb.txt", { type: "text/plain" }),
    );
    expect(resource.text).toBe(text);
    expect(resourceText(resource)).toBe(text);
    await expect(
      parseAttachment(
        new File(["AutoCAD Binary DXF\r\n\u001a\u0000"], "binary.dxf", {
          type: "application/dxf",
        }),
      ),
    ).rejects.toThrow("ASCII DXF");
  });
  it("preserves absolute viewport proportions and rejects percentages without a usable viewBox", () => {
    const asset = reusableSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" width="25.4mm" height="48px" viewBox="0 0 100 100"><path d="M0 0L100 100"/></svg>',
      "physical",
    );
    expect(asset.width).toBeCloseTo(96);
    expect(asset.height).toBe(48);
    expect(asset.svg.getAttribute("viewBox")).toBe("0 0 100 100");
    expect(asset.svg.getAttribute("fill")).toBe("black");
    expect(asset.svg.getAttribute("stroke")).toBe("none");
    expect(asset.svg.getAttribute("marker-end")).toBe("none");
    expect(() =>
      reusableSvg(
        '<svg width="100%" height="100%"><path d="M0 0L1 1"/></svg>',
        "invalid",
      ),
    ).toThrow("dimensions");
  });
  it("accepts large single-line SVG/text without a character cap and preserves exact bytes through save/restore", async () => {
    const text = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><!--${"标志".repeat(60000)}--><path d="M0 0L100 50"/></svg>`;
    const resource = await parseAttachment(
      new File([text], "large.svg", { type: "image/svg+xml" }),
    );
    expect(resource.text).toBe(text);
    const project = newProject();
    project.messages.push({
      role: "user",
      text: "Keep this logo",
      attachments: [resource],
    });
    const restored = projectSchema.parse(JSON.parse(JSON.stringify(project)));
    expect(projectResources(restored)[0].text).toBe(text);
    expect(resourceMetadata(resource)).toMatchObject({
      viewBox: [0, 0, 100, 50],
    });
    const session = new ResourceToolSession(projectResources(restored));
    const read = JSON.parse(
      (
        await session.execute(
          call("read_resource", {
            resource_id: resource.id,
            offset: 100000,
            limit: 12000,
          }),
          signal(),
        )
      ).output,
    );
    expect(read.text).toHaveLength(12000);
    expect(read.next_offset).toBe(112000);
    const found = JSON.parse(
      (
        await session.execute(
          call("read_resource", {
            resource_id: resource.id,
            query: "<path",
            limit: 100,
          }),
          signal(),
        )
      ).output,
    );
    expect(found.text).toContain('d="M0 0L100 50"');
  });
  it("scopes IDs to the originating project and bounds serialized output even for control characters", async () => {
    const session = new ResourceToolSession([
      { ...item, type: "text", text: "\u0000".repeat(30000) },
    ]);
    const other = JSON.parse(
      (
        await session.execute(
          call("read_resource", { resource_id: "other-project" }),
          signal(),
        )
      ).output,
    );
    expect(other.ok).toBe(false);
    const read = await session.execute(
      call("read_resource", { resource_id: item.id, limit: 12000 }),
      signal(),
    );
    expect(read.output.length).toBeLessThan(64000);
    expect(JSON.parse(read.output).next_offset).toBeGreaterThan(0);
    expect(
      JSON.parse(
        (
          await session.execute(
            call("read_resource", { resource_id: item.id, limit: 12001 }),
            signal(),
          )
        ).output,
      ).ok,
    ).toBe(false);
    const listed = JSON.parse(
      (await session.execute(call("list_resources", {}), signal())).output,
    );
    expect(listed.resources[0]).not.toHaveProperty("text");
    expect(projectResources(newProject())).toEqual([]);
  });
  it("keeps dangerous SVG content inert while preserving static CSS, gradients and clipping", () => {
    const unsafe = logo.replace(
      "</svg>",
      '<script>alert(1)</script><image href="https://evil.example/leak"/><foreignObject><div>unsafe</div></foreignObject><use href="https://evil.example/object"/><defs><filter id="blur"><feGaussianBlur stdDeviation="1"/><feImage href="https://evil.example/filter"/></filter></defs></svg>',
    );
    const svg = sanitizeResourceSvg(unsafe);
    expect(serialize(svg)).not.toMatch(
      /script|foreignObject|evil\.example|<image|<style/,
    );
    expect(svg.querySelector("#mark")?.getAttribute("fill")).toBe(
      "url(#paint)",
    );
    expect(svg.querySelector("#mark")?.getAttribute("stroke")).toBe("blue");
    expect(svg.querySelector("linearGradient")).toBeTruthy();
    expect(svg.querySelector("feGaussianBlur")).toBeTruthy();
    expect(svg.querySelector("feImage")).toBeNull();
  });
});

describe("intact SVG placement and transform", () => {
  it("requires an explicit size reference and preserves optional origin anchoring", () => {
    const args = {
      resource_id: "logo",
      object_id: "brand",
      x: 50,
      y: 30,
      width: 40,
    };
    expect(placeSvgSchema.safeParse(args).success).toBe(false);
    expect(placeSvgSchema.safeParse({ ...args, bounds: null }).success).toBe(
      false,
    );
    expect(
      placeSvgSchema.parse({ ...args, bounds: "canvas" }).anchor,
    ).toBeUndefined();
    expect(
      placeSvgSchema.parse({ ...args, bounds: "content", anchor: "center" }),
    ).toMatchObject({ bounds: "content", anchor: "center" });
  });
  it("preserves path/paint/clip references and independent instances, then transforms without rewriting geometry", async () => {
    const session = new DrawingToolSession(
      { path: "drawing.html", revision: "base", html: EXAMPLE.html },
      EXAMPLE,
      validate,
      () => true,
      (id) => {
        if (id !== item.id) throw new Error("Not permitted");
        return item;
      },
    );
    const place = async (id: string) =>
      JSON.parse(
        await session.execute(
          call("place_svg", {
            bounds: "canvas",
            resource_id: "logo",
            object_id: id,
            revision: session.source.revision,
            x: 80,
            y: 5,
            width: 20,
          }),
          signal(),
        ),
      );
    expect(await place("brand")).toHaveProperty("ok", true);
    expect(await place("brand2")).toHaveProperty("ok", true);
    let svg = sanitizeSVG(session.drawing.svg);
    const instance = svg.querySelector("#brand")!;
    expect(instance.getAttribute("transform")).toBe(
      "translate(80 5) rotate(0) scale(0.2)",
    );
    expect(instance.querySelector("svg")?.getAttribute("viewBox")).toBe(
      "10 20 100 50",
    );
    const path = instance.querySelector("path")!;
    expect(path.getAttribute("d")).toBe("M10 20L110 20L60 70Z");
    expect(path.getAttribute("fill")).toBe(
      `url(#${instance.querySelector("linearGradient")!.id})`,
    );
    expect(instance.querySelector("use")?.getAttribute("href")).toBe(
      `#${path.id}`,
    );
    const geometry = instance.innerHTML;
    expect(
      JSON.parse(
        await session.execute(
          call("transform_object", {
            object_id: "brand",
            revision: session.source.revision,
            x: 1,
            y: 2,
            scale: 0.5,
            rotation: 30,
          }),
          signal(),
        ),
      ).ok,
    ).toBe(true);
    svg = sanitizeSVG(session.drawing.svg);
    expect(svg.querySelector("#brand")!.innerHTML).toBe(geometry);
    const committed = session.drawing.svg;
    expect(
      JSON.parse(
        await session.execute(
          call("transform_object", {
            object_id: "brand",
            revision: "stale",
            x: 0,
            y: 0,
            scale: 1,
            rotation: 0,
          }),
          signal(),
        ),
      ).ok,
    ).toBe(false);
    expect(session.drawing.svg).toBe(committed);
  });
  it("runs resource tools on a blank project with metadata-only requests, then commits only after terminal success", async () => {
    const requests: DrawingRequest[] = [];
    const responses: DrawingResult[] = [
      {
        kind: "tool_calls",
        content: "",
        calls: [call("inspect_resource", { resource_id: item.id })],
      },
      {
        kind: "tool_calls",
        content: "",
        calls: [
          call("place_svg", {
            bounds: "canvas",
            resource_id: item.id,
            object_id: "brand",
            x: 80,
            y: 5,
            width: 20,
            canvas: { width: 120, height: 80 },
          }),
        ],
      },
      { kind: "message", message: "Placed the original logo." },
    ];
    const result = await runDrawingAgent({
      projectId: "test-project",
      context: drawingContext("Place logo on a 120 x 80 mm sheet", [], null),
      resources: [item],
      config,
      drawing: null,
      signal: signal(),
      validate,
      isCurrent: () => true,
      request: async (input) => {
        requests.push(input);
        return responses.shift()!;
      },
      onDelta() {},
      onRound() {},
    });
    expect(requests[0].attachments).toBeUndefined();
    expect(JSON.stringify(requests[0])).not.toContain("M10 20L110 20");
    expect(requests[0].resources?.[0]).toMatchObject({
      id: "logo",
      viewBox: [10, 20, 100, 50],
    });
    expect(result.drawing?.svg).toContain("M10 20L110 20L60 70Z");
    expect(result.drawing?.svg).toContain('width="120mm"');
    expect(requests[2].agentTurns).toHaveLength(2);
  });
});

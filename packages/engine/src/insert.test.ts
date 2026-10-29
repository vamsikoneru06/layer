import { LIMITS, validateDoc } from "@vash/schema";
import { describe, expect, it } from "vitest";
import { EditorCore } from "./editor-core";
import { createNode, insertLayer, insertShape, newNodeId, type InsertKind, type ShapeSpec } from "./insert";
import { docWith, rect } from "./test-docs";

const PATH_SPEC: ShapeSpec = {
  name: "Diamond",
  geometry: { kind: "path", d: "M0.5 0 L1 0.5 L0.5 1 L0 0.5 Z" },
  width: 200,
  height: 200,
  fill: { type: "solid", color: "#FF0000" },
  stroke: null,
};

const KINDS: InsertKind[] = ["heading", "subheading", "body", "rect", "rounded", "ellipse", "triangle", "frame", "frame-circle"];

describe("createNode", () => {
  it("makes a valid layer of every kind, centred on the artboard", () => {
    for (const kind of KINDS) {
      const node = createNode(kind, docWith([]), `id-${kind}`);
      const doc = docWith([node]);
      expect(validateDoc(doc), kind).toMatchObject({ ok: true });
      expect(node.transform).toMatchObject({ x: 500, y: 500 });
    }
  });

  it("picks text colour for the background", () => {
    const light = createNode("heading", docWith([]));
    const dark = createNode("heading", { ...docWith([]), artboard: { width: 1000, height: 1000, background: { type: "solid", color: "#111111" } } });
    expect(light).toMatchObject({ color: "#1D1D1F" });
    expect(dark).toMatchObject({ color: "#FFFFFF" });
  });

  it("gives ids in the schema's alphabet, different each time", () => {
    const a = newNodeId();
    expect(a).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(newNodeId()).not.toBe(a);
  });
});

describe("insertLayer", () => {
  it("adds the layer on top as one undo step, selects it, and starts typing for text", () => {
    const core = new EditorCore(docWith([rect("a", {})]));
    expect(insertLayer(core, "heading")).toBe(true);
    const { doc, selection, editing } = core.getState();
    const id = doc.root.at(-1)!;
    expect(doc.nodes[id]).toMatchObject({ type: "text", content: "Add a heading" });
    expect(selection).toEqual([id]);
    expect(editing).toBe(id);
    core.endTextEdit(true);
    core.undo();
    expect(core.getState().doc.root).toEqual(["a"]);
  });

  it("refuses beyond the layer limit", () => {
    const many = Array.from({ length: LIMITS.designNodes }, (_, i) => rect(`r${i}`, {}));
    const core = new EditorCore(docWith(many));
    expect(insertLayer(core, "rect")).toBe(false);
    expect(core.getState().notice).toMatch(/up to 500 layers/);
  });
});

describe("insertShape", () => {
  it("inserts a centred, selected path shape on top with a fresh id", () => {
    const core = new EditorCore(docWith([rect("a", {})]));
    expect(insertShape(core, PATH_SPEC)).toBe(true);
    const { doc, selection } = core.getState();
    const id = doc.root.at(-1)!;
    expect(doc.root).toEqual(["a", id]);
    expect(id).not.toBe("a");
    expect(doc.nodes[id]).toMatchObject({
      type: "shape",
      name: "Diamond",
      width: 200,
      height: 200,
      geometry: PATH_SPEC.geometry,
      fill: PATH_SPEC.fill,
      stroke: null,
      transform: { x: 500, y: 500 },
    });
    expect(selection).toEqual([id]);
    expect(validateDoc(doc)).toMatchObject({ ok: true });
  });

  it("keeps a stroke-only shape with no fill", () => {
    const core = new EditorCore(docWith([]));
    const spec: ShapeSpec = { ...PATH_SPEC, fill: null, stroke: { color: "#000000", width: 4 } };
    expect(insertShape(core, spec)).toBe(true);
    const doc = core.getState().doc;
    expect(doc.nodes[doc.root[0]!]).toMatchObject({ type: "shape", fill: null, stroke: { color: "#000000", width: 4 } });
    expect(validateDoc(doc)).toMatchObject({ ok: true });
  });

  it("scales an oversized shape down proportionally to fit the artboard", () => {
    const core = new EditorCore(docWith([]));
    // Artboard is 1000 x 1000. A 2000 x 500 spec scales by 0.5 to 1000 x 250.
    expect(insertShape(core, { ...PATH_SPEC, width: 2000, height: 500 })).toBe(true);
    const doc = core.getState().doc;
    expect(doc.nodes[doc.root[0]!]).toMatchObject({ width: 1000, height: 250, transform: { x: 500, y: 500 } });
    expect(validateDoc(doc)).toMatchObject({ ok: true });
  });

  it("keeps at least 1 px when scaling", () => {
    const core = new EditorCore(docWith([]));
    expect(insertShape(core, { ...PATH_SPEC, width: 1e6, height: 1 })).toBe(true);
    const node = core.getState().doc.nodes[core.getState().doc.root[0]!];
    expect(node).toMatchObject({ height: 1 });
    expect(node!.width).toBeCloseTo(1000, 6);
  });

  it("refuses beyond the layer limit with the same notice", () => {
    const many = Array.from({ length: LIMITS.designNodes }, (_, i) => rect(`r${i}`, {}));
    const core = new EditorCore(docWith(many));
    expect(insertShape(core, PATH_SPEC)).toBe(false);
    expect(core.getState().notice).toMatch(/up to 500 layers/);
    expect(core.getState().doc.root).toHaveLength(LIMITS.designNodes);
  });

  it("is one undo step", () => {
    const core = new EditorCore(docWith([rect("a", {})]));
    expect(insertShape(core, PATH_SPEC)).toBe(true);
    core.undo();
    expect(core.getState().doc.root).toEqual(["a"]);
  });
});

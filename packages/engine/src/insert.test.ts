import { LIMITS, validateDoc } from "@vash/schema";
import { describe, expect, it } from "vitest";
import { EditorCore } from "./editor-core";
import { createNode, insertLayer, newNodeId, type InsertKind } from "./insert";
import { docWith, rect } from "./test-docs";

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

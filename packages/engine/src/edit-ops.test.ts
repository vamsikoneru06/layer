import { LIMITS } from "@vash/schema";
import { describe, expect, it } from "vitest";
import { serializeSelection } from "./clipboard";
import { EditorCore } from "./editor-core";
import { copySelection, cutSelection, duplicateSelection, groupSelection, pasteText, ungroupSelection } from "./edit-ops";
import { docWith, rect } from "./test-docs";

const setup = () => new EditorCore(docWith([rect("a", { x: 100, y: 100 }), rect("b", { x: 300, y: 300 }), { ...rect("locked", { x: 500 }), lock: "locked" }]));
const tamper = (text: string, edit: (node: Record<string, unknown>) => void) => {
  const body = JSON.parse(text.slice("vash:".length));
  edit(body.nodes[0]);
  return `vash:${JSON.stringify(body)}`;
};

describe("duplicateSelection, groupSelection, ungroupSelection", () => {
  it("duplicates, selects the copy and undoes in one step", () => {
    const core = setup();
    core.select(["a"]);
    expect(duplicateSelection(core)).toBe(true);
    expect(core.doc.root).toHaveLength(4);
    expect(core.getState().selection).toEqual([core.doc.root.at(-1)]);
    core.undo();
    expect(core.doc.root).toHaveLength(3);
  });

  it("groups, then ungroups, keeping each step undoable", () => {
    const core = setup();
    core.select(["a", "b"]);
    expect(groupSelection(core)).toBe(true);
    const [g] = core.getState().selection;
    expect(core.doc.nodes[g!]!.type).toBe("group");
    expect(ungroupSelection(core)).toBe(true);
    expect(core.doc.root).toEqual(["a", "b", "locked"]);
    core.undo();
    expect(core.doc.nodes[g!]).toBeDefined();
  });

  it("refuses to group a locked layer and says why (Review Focus 4)", () => {
    const core = setup();
    core.select(["a", "locked"]);
    expect(groupSelection(core)).toBe(false);
    expect(core.getState().notice).toMatch(/locked/i);
    expect(core.doc.root).toEqual(["a", "b", "locked"]);
  });

  it("refuses to duplicate at the layer cap with a message, not an invalid design (Review Focus 3)", () => {
    const core = new EditorCore(docWith(Array.from({ length: LIMITS.designNodes }, (_, i) => rect(`r${i}`, {}))));
    core.select(["r0"]);
    expect(duplicateSelection(core)).toBe(false);
    expect(core.getState().notice).toMatch(/up to 500 layers/);
    expect(Object.keys(core.doc.nodes)).toHaveLength(LIMITS.designNodes);
  });
});

describe("copy, cut and paste", () => {
  it("copies without changing the design", () => {
    const core = setup();
    core.select(["a"]);
    const before = core.doc;
    expect(copySelection(core)).toMatch(/^vash:/);
    expect(core.doc).toBe(before);
  });

  it("cuts, then pastes back as separate undo steps", () => {
    const core = setup();
    core.select(["a"]);
    const text = cutSelection(core)!;
    expect(core.doc.nodes.a).toBeUndefined();
    expect(pasteText(core, text)).toBe(true);
    expect(Object.keys(core.doc.nodes)).toHaveLength(3);
    core.undo();
    expect(core.doc.root).toEqual(["b", "locked"]);
    core.undo();
    expect(core.doc.root).toEqual(["a", "b", "locked"]);
  });

  it("does not cut a locked layer and puts nothing on the clipboard (Review Focus 4)", () => {
    const core = setup();
    core.select(["locked"]);
    expect(cutSelection(core)).toBeNull();
    expect(core.doc.nodes.locked).toBeDefined();
    expect(core.getState().notice).toMatch(/locked/i);
  });

  it("refuses text that is not a payload, with a message (Review Focus 1)", () => {
    const core = setup();
    expect(pasteText(core, "hello")).toBe(false);
    expect(core.getState().notice).toBe("Nothing to paste.");
  });

  it("refuses a payload that would make the design invalid, and changes nothing (Review Focus 1)", () => {
    const core = setup();
    const text = serializeSelection(core.doc, ["a"])!;
    const before = core.doc;
    for (const edit of [
      (n: Record<string, unknown>) => (n.evil = 1),
      (n: Record<string, unknown>) => (n.width = 1e9),
      (n: Record<string, unknown>) => (n.type = "banana"),
      (n: Record<string, unknown>) => (n.opacity = "high"),
    ]) {
      expect(pasteText(core, tamper(text, edit))).toBe(false);
      expect(core.doc).toBe(before);
    }
    expect(core.getState().notice).toMatch(/invalid/i);
  });

  it("does not let a __proto__ key pollute anything (Review Focus 1)", () => {
    const core = setup();
    const text = serializeSelection(core.doc, ["a"])!;
    const hostile = text.replace(/^vash:\{/, 'vash:{"__proto__":{"polluted":true},').replace(/"id":"a"/, '"__proto__":{"polluted":true},"id":"a"');
    pasteText(core, hostile);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(core.doc.root).toEqual(["a", "b", "locked"]);
  });
});

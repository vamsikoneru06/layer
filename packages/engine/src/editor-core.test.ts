import { describe, expect, it } from "vitest";
import { EditorCore } from "./editor-core";
import { docWith, rect } from "./test-docs";

const core = (mode: "design" | "template" = "design") =>
  new EditorCore(docWith([rect("a", { x: 100 }), { ...rect("locked", { x: 500 }), lock: "locked" }, { ...rect("co", { x: 800 }), lock: "content-only" }]), { mode });

describe("EditorCore", () => {
  it("publishes a new state snapshot on every change and keeps it stable in between", () => {
    const c = core();
    const first = c.getState();
    expect(c.getState()).toBe(first);
    let calls = 0;
    c.subscribe(() => calls++);
    c.select(["a"]);
    expect(c.getState()).not.toBe(first);
    expect(c.getState().selection).toEqual(["a"]);
    expect(calls).toBe(1);
  });

  it("runs commands through the lock policy and reports refusals", () => {
    const c = core();
    expect(c.dispatch({ type: "delete", id: "locked" })).toBe(false);
    expect(c.getState().notice).toMatch(/locked/i);
    expect(c.getState().doc.nodes.locked).toBeDefined();
    expect(c.dispatch({ type: "delete", id: "a" })).toBe(true);
    expect(c.getState().canUndo).toBe(true);
  });

  it("drops deleted layers from the selection, and undo brings them back into the document", () => {
    const c = core();
    c.select(["a"]);
    c.dispatch({ type: "delete", id: "a" });
    expect(c.getState().selection).toEqual([]);
    c.undo();
    expect(c.getState().doc.nodes.a).toBeDefined();
  });

  it("previews a transaction and commits it as one step, refusing it up front when locked", () => {
    const c = core();
    const t = c.getState().doc.nodes.a!.transform;
    c.beginTransaction();
    c.preview({ type: "update", id: "a", patch: { transform: { ...t, x: 150 } } });
    c.preview({ type: "update", id: "a", patch: { transform: { ...t, x: 170 } } });
    c.commitTransaction();
    expect(c.getState().doc.nodes.a!.transform.x).toBe(170);
    c.undo();
    expect(c.getState().doc.nodes.a!.transform.x).toBe(100);

    c.beginTransaction();
    expect(c.preview({ type: "update", id: "co", patch: { width: 10 } })).toBe(false);
    c.commitTransaction();
    expect(c.getState().doc.nodes.co!.width).toBe(100);
  });

  it("reports which selected layers are layout-locked", () => {
    const c = core();
    c.select(["co"]);
    expect(c.getState().layoutLocked).toBe(true);
    c.select(["a"]);
    expect(c.getState().layoutLocked).toBe(false);
    const author = core("template");
    author.select(["co"]);
    expect(author.getState().layoutLocked).toBe(false);
  });

  it("selects only layers that exist and ignores duplicates", () => {
    const c = core();
    c.select(["a", "ghost", "a"]);
    expect(c.getState().selection).toEqual(["a"]);
  });
});

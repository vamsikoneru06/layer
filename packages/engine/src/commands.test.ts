import { describe, expect, it } from "vitest";
import { applyCommand } from "./commands";
import { History } from "./history";
import { docWith, group, rect } from "./test-docs";

const base = () => docWith([rect("a", { x: 100 }), group("g", { x: 500 }, ["c1", "c2"]), rect("b", { x: 900 })], [rect("c1", {}), rect("c2", {})]);

describe("applyCommand", () => {
  it("updates a node with structural sharing and a precise inverse", () => {
    const doc = base();
    const { doc: next, inverse } = applyCommand(doc, { type: "update", id: "a", patch: { opacity: 0.5, transform: { ...doc.nodes.a!.transform, x: 150 } } });
    expect(next.nodes.a).toMatchObject({ opacity: 0.5, transform: { x: 150 } });
    expect(next.nodes.b).toBe(doc.nodes.b);
    expect(doc.nodes.a!.opacity).toBe(1);
    expect(applyCommand(next, inverse).doc.nodes.a).toEqual(doc.nodes.a);
  });

  it("deletes a group with its children and restores them in place", () => {
    const doc = base();
    const { doc: next, inverse } = applyCommand(doc, { type: "delete", id: "g" });
    expect(next.root).toEqual(["a", "b"]);
    expect(Object.keys(next.nodes).sort()).toEqual(["a", "b"]);
    const restored = applyCommand(next, inverse).doc;
    expect(restored.root).toEqual(doc.root);
    expect(restored.nodes).toEqual(doc.nodes);
  });

  it("changes the artboard and inverts back", () => {
    const doc = base();
    const { doc: next, inverse } = applyCommand(doc, { type: "artboard", patch: { width: 1080, background: { type: "solid", color: "#000000" } } });
    expect(next.artboard).toEqual({ width: 1080, height: 1000, background: { type: "solid", color: "#000000" } });
    expect(next.nodes).toBe(doc.nodes);
    expect(applyCommand(next, inverse).doc.artboard).toEqual(doc.artboard);
  });

  it("reorders within the parent and inverts back", () => {
    const doc = base();
    const { doc: next, inverse } = applyCommand(doc, { type: "reorder", id: "a", index: 2 });
    expect(next.root).toEqual(["g", "b", "a"]);
    const inside = applyCommand(doc, { type: "reorder", id: "c2", index: 0 }).doc;
    expect((inside.nodes.g as { children: string[] }).children).toEqual(["c2", "c1"]);
    expect(applyCommand(next, inverse).doc.root).toEqual(doc.root);
  });

  it("inserts at an index and inverts to a delete", () => {
    const doc = base();
    const { doc: next, inverse } = applyCommand(doc, { type: "insert", nodes: [rect("new", {})], parent: null, index: 1 });
    expect(next.root).toEqual(["a", "new", "g", "b"]);
    expect(applyCommand(next, inverse).doc).toEqual(doc);
  });

  it("runs a batch and undoes it in reverse order", () => {
    const doc = base();
    const { doc: next, inverse } = applyCommand(doc, {
      type: "batch",
      commands: [
        { type: "update", id: "a", patch: { name: "one" } },
        { type: "delete", id: "a" },
      ],
    });
    expect(next.nodes.a).toBeUndefined();
    expect(applyCommand(next, inverse).doc).toEqual(doc);
  });

  it("ignores commands on unknown ids without changing the document", () => {
    const doc = base();
    expect(applyCommand(doc, { type: "update", id: "nope", patch: { name: "x" } }).doc).toBe(doc);
    expect(applyCommand(doc, { type: "delete", id: "nope" }).doc).toBe(doc);
  });
});

describe("History", () => {
  it("undoes and redoes, and a new edit clears the redo stack", () => {
    const h = new History(base());
    h.execute({ type: "update", id: "a", patch: { name: "one" } });
    h.execute({ type: "update", id: "a", patch: { name: "two" } });
    h.undo();
    expect(h.doc.nodes.a!.name).toBe("one");
    h.redo();
    expect(h.doc.nodes.a!.name).toBe("two");
    h.undo();
    h.execute({ type: "update", id: "a", patch: { name: "three" } });
    expect(h.canRedo).toBe(false);
  });

  it("coalesces a transaction into a single undo step", () => {
    const h = new History(base());
    h.begin();
    for (let x = 101; x <= 140; x++) h.update({ type: "update", id: "a", patch: { transform: { ...h.baseDoc!.nodes.a!.transform, x } } });
    expect(h.doc.nodes.a!.transform.x).toBe(140);
    h.commit();
    h.undo();
    expect(h.doc.nodes.a!.transform.x).toBe(100);
    expect(h.canUndo).toBe(false);
  });

  it("cancels a transaction back to where it began, leaving no history", () => {
    const h = new History(base());
    h.begin();
    h.update({ type: "delete", id: "a" });
    h.cancel();
    expect(h.doc.nodes.a).toBeDefined();
    expect(h.canUndo).toBe(false);
  });

  it("keeps at most 200 steps", () => {
    const h = new History(base());
    for (let i = 0; i < 250; i++) h.execute({ type: "update", id: "a", patch: { name: `n${i}` } });
    let steps = 0;
    while (h.canUndo) {
      h.undo();
      steps++;
    }
    expect(steps).toBe(200);
  });

  it("notifies listeners on every change", () => {
    const h = new History(base());
    let calls = 0;
    const off = h.subscribe(() => calls++);
    h.execute({ type: "update", id: "a", patch: { name: "x" } });
    h.undo();
    off();
    h.redo();
    expect(calls).toBe(2);
  });
});

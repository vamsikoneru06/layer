import { describe, expect, it } from "vitest";
import { applyCommand } from "./commands";
import { EditorCore } from "./editor-core";
import { docWith, rect } from "./test-docs";

describe("meta command", () => {
  it("changes the title and its inverse restores it", () => {
    const doc = docWith([rect("a", {})]);
    const { doc: next, inverse } = applyCommand(doc, { type: "meta", patch: { title: "Summer sale" } });
    expect(next.meta.title).toBe("Summer sale");
    expect(applyCommand(next, inverse).doc.meta.title).toBe("Test");
  });

  it("does nothing when the title is unchanged, so it adds no undo step", () => {
    const core = new EditorCore(docWith([]));
    core.dispatch({ type: "meta", patch: { title: "Test" } });
    expect(core.getState().canUndo).toBe(false);
  });

  it("is one undo step and is allowed even when layers are locked", () => {
    const core = new EditorCore(docWith([{ ...rect("a", {}), lock: "locked" }]));
    expect(core.dispatch({ type: "meta", patch: { title: "New name" } })).toBe(true);
    expect(core.doc.meta.title).toBe("New name");
    core.undo();
    expect(core.doc.meta.title).toBe("Test");
  });
});

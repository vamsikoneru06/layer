import { describe, expect, it } from "vitest";
import { EditorCore } from "./editor-core";
import { handleKey, type KeyInput } from "./shortcuts";
import { docWith, rect } from "./test-docs";

const key = (k: string, o: Partial<KeyInput> = {}): KeyInput => ({ key: k, mod: false, shift: false, alt: false, ...o });
const setup = () => new EditorCore(docWith([rect("a", { x: 100, y: 100 }), rect("b", { x: 300, y: 300 }), { ...rect("locked", { x: 500 }), lock: "locked" }]));

describe("handleKey", () => {
  it("nudges the selection by 1 px, or 10 with Shift, as undoable steps", () => {
    const c = setup();
    c.select(["a", "b"]);
    expect(handleKey(c, key("ArrowRight"))).toBe(true);
    handleKey(c, key("ArrowDown", { shift: true }));
    expect(c.doc.nodes.a!.transform).toMatchObject({ x: 101, y: 110 });
    expect(c.doc.nodes.b!.transform).toMatchObject({ x: 301, y: 310 });
    c.undo();
    expect(c.doc.nodes.a!.transform.y).toBe(100);
  });

  it("deletes the selection; a locked layer in it refuses the whole delete", () => {
    const c = setup();
    c.select(["a"]);
    handleKey(c, key("Backspace"));
    expect(c.doc.nodes.a).toBeUndefined();
    c.select(["b", "locked"]);
    handleKey(c, key("Delete"));
    expect(c.doc.nodes.b).toBeDefined();
    expect(c.getState().notice).toMatch(/locked/i);
  });

  it("undoes and redoes with ⌘Z / ⇧⌘Z / ⌘Y", () => {
    const c = setup();
    c.select(["a"]);
    handleKey(c, key("ArrowRight"));
    handleKey(c, key("z", { mod: true }));
    expect(c.doc.nodes.a!.transform.x).toBe(100);
    handleKey(c, key("Z", { mod: true, shift: true }));
    expect(c.doc.nodes.a!.transform.x).toBe(101);
    handleKey(c, key("z", { mod: true }));
    handleKey(c, key("y", { mod: true }));
    expect(c.doc.nodes.a!.transform.x).toBe(101);
  });

  it("selects all top-level layers and clears with Escape", () => {
    const c = setup();
    handleKey(c, key("a", { mod: true }));
    expect(c.getState().selection).toEqual(["a", "b", "locked"]);
    handleKey(c, key("Escape"));
    expect(c.getState().selection).toEqual([]);
  });

  it("leaves unrelated keys to the browser", () => {
    expect(handleKey(setup(), key("q"))).toBe(false);
    expect(handleKey(setup(), key("ArrowLeft"))).toBe(false); // nothing selected
  });
});

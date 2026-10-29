import { describe, expect, it } from "vitest";
import { EditorCore } from "./editor-core";
import type { Tool } from "./interaction";
import { handleKey, type KeyInput } from "./shortcuts";
import { docWith, rect, text } from "./test-docs";

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

  it("starts typing into a selected text layer on Enter, and leaves other layers alone", () => {
    const c = new EditorCore(docWith([text("t", {}), rect("r", {})]));
    c.select(["t"]);
    expect(handleKey(c, key("Enter"))).toBe(true);
    expect(c.getState().editing).toBe("t");
    c.endTextEdit(true);
    c.select(["r"]);
    expect(handleKey(c, key("Enter"))).toBe(false);
    expect(c.getState().editing).toBeNull();
  });
});

describe("tool keys", () => {
  it("V selects the select tool and H the hand tool, with or without a selection", () => {
    const c = setup();
    const seen: string[] = [];
    const setTool = (t: Tool) => {
      seen.push(t);
    };
    expect(handleKey(c, key("h"), setTool)).toBe(true);
    expect(handleKey(c, key("V"), setTool)).toBe(true);
    c.select(["a"]);
    expect(handleKey(c, key("h"), setTool)).toBe(true);
    expect(seen).toEqual(["hand", "select", "hand"]);
  });

  it("ignores the keys without a setter, and with Ctrl, Cmd or Alt", () => {
    const c = setup();
    const seen: string[] = [];
    const setTool = (t: Tool) => {
      seen.push(t);
    };
    expect(handleKey(c, key("v"))).toBe(false);
    expect(handleKey(c, key("h", { mod: true }), setTool)).toBe(false);
    expect(handleKey(c, key("v", { alt: true }), setTool)).toBe(false);
    expect(seen).toEqual([]);
  });

  it("changes no layer and adds no undo step", () => {
    const c = setup();
    c.select(["a"]);
    handleKey(c, key("h"), () => {});
    expect(c.getState().canUndo).toBe(false);
    expect(c.doc.nodes.a!.transform).toMatchObject({ x: 100, y: 100 });
  });
});

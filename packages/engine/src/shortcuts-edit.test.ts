import { describe, expect, it } from "vitest";
import { EditorCore } from "./editor-core";
import { handleKey, type KeyInput } from "./shortcuts";
import { docWith, rect } from "./test-docs";

const key = (k: string, o: Partial<KeyInput> = {}): KeyInput => ({ key: k, mod: false, shift: false, alt: false, ...o });
const setup = () => new EditorCore(docWith([rect("a", { x: 100 }), rect("b", { x: 300 })]));

describe("editing shortcuts", () => {
  it("Ctrl+D duplicates the selection", () => {
    const c = setup();
    c.select(["a"]);
    expect(handleKey(c, key("d", { mod: true }))).toBe(true);
    expect(c.doc.root).toHaveLength(3);
  });

  it("Ctrl+G groups and Ctrl+Shift+G ungroups", () => {
    const c = setup();
    c.select(["a", "b"]);
    expect(handleKey(c, key("g", { mod: true }))).toBe(true);
    expect(c.doc.root).toHaveLength(1);
    expect(handleKey(c, key("G", { mod: true, shift: true }))).toBe(true);
    expect(c.doc.root).toEqual(["a", "b"]);
  });

  it("uses the key even with nothing selected, so the browser's bookmark and find shortcuts stay quiet", () => {
    const c = setup();
    expect(handleKey(c, key("d", { mod: true }))).toBe(true);
    expect(c.getState().notice).toBe("Select a layer to duplicate.");
    expect(handleKey(c, key("g", { mod: true }))).toBe(true);
  });

  it("leaves Ctrl+Shift+D and Ctrl+Alt+G to the browser", () => {
    const c = setup();
    c.select(["a"]);
    expect(handleKey(c, key("d", { mod: true, shift: true }))).toBe(false);
    expect(handleKey(c, key("g", { mod: true, alt: true }))).toBe(false);
    expect(c.doc.root).toHaveLength(2);
  });
});

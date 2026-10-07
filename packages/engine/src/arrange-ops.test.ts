import { describe, expect, it } from "vitest";
import { EditorCore } from "./editor-core";
import {
  alignSelection,
  copiedStyleOf,
  copyStyleOfSelection,
  distributeSelection,
  flipSelection,
  hasCopiedStyle,
  pasteStyleToSelection,
  reorderSelection,
  toggleLockSelection,
} from "./edit-ops";
import { handleKey, type KeyInput } from "./shortcuts";
import { docWith, rect, text } from "./test-docs";

const setup = () =>
  new EditorCore(docWith([{ ...rect("a", { x: 100, y: 100 }), opacity: 0.5, fill: { type: "solid", color: "#00AA00" } }, rect("b", { x: 300, y: 300 }), rect("c", { x: 800, y: 500 }), text("t", { x: 600, y: 700 })]));

describe("selection wrappers: one undo step each", () => {
  const cases: [string, (c: EditorCore) => boolean, string[]][] = [
    ["reorder", (c) => reorderSelection(c, "front"), ["a"]],
    ["align", (c) => alignSelection(c, "right"), ["a", "b"]],
    ["distribute", (c) => distributeSelection(c, "horizontal"), ["a", "b", "c"]],
    ["flip", (c) => flipSelection(c, "vertical"), ["a", "b"]],
    ["lock", (c) => toggleLockSelection(c), ["a", "b"]],
  ];
  for (const [name, act, selection] of cases) {
    it(`${name} changes the design, keeps the selection and undoes in one step`, () => {
      const core = setup();
      const before = core.doc;
      core.select(selection);
      expect(act(core)).toBe(true);
      expect(core.doc).not.toEqual(before);
      expect(core.getState().selection).toEqual(selection);
      core.undo();
      expect(core.doc).toEqual(before);
      expect(core.getState().canUndo).toBe(false);
    });
  }

  it("a refused tool changes nothing and leaves its reason as the notice", () => {
    const core = setup();
    core.select(["t"]);
    expect(flipSelection(core, "horizontal")).toBe(false);
    expect(core.getState().notice).toBe("Text can't be flipped.");
    expect(reorderSelection(core, "forward")).toBe(false);
    expect(core.getState().notice).toBe("Already at the front.");
    expect(core.getState().canUndo).toBe(false);
  });

  it("a locked layer is refused by the policy and says so", () => {
    const core = setup();
    core.select(["a", "b"]);
    toggleLockSelection(core);
    expect(alignSelection(core, "left")).toBe(false);
    expect(core.getState().notice).toBe("This layer is locked by the template.");
    expect(toggleLockSelection(core)).toBe(true);
    expect(alignSelection(core, "left")).toBe(true);
  });
});

describe("copy and paste style", () => {
  it("copies from exactly one layer and pastes in one undo step", () => {
    const core = setup();
    expect(hasCopiedStyle(core)).toBe(false);
    core.select(["a"]);
    expect(copyStyleOfSelection(core)).toBe(true);
    expect(hasCopiedStyle(core)).toBe(true);
    expect(copiedStyleOf(core)).toMatchObject({ type: "shape", fields: { opacity: 0.5 } });
    core.select(["b", "t"]);
    const before = core.doc;
    expect(pasteStyleToSelection(core)).toBe(true);
    expect(core.doc.nodes.b).toMatchObject({ opacity: 0.5, fill: { color: "#00AA00" } });
    expect(core.getState().notice).toBe("Style pasted to 1 layer. 1 layer of another kind was skipped.");
    expect(core.getState().selection).toEqual(["b", "t"]);
    core.undo();
    expect(core.doc).toEqual(before);
  });

  it("needs exactly one layer to copy from", () => {
    const core = setup();
    expect(copyStyleOfSelection(core)).toBe(false);
    expect(core.getState().notice).toBe("Select one layer to copy its style.");
    core.select(["a", "b"]);
    expect(copyStyleOfSelection(core)).toBe(false);
    expect(hasCopiedStyle(core)).toBe(false);
  });

  it("refuses to paste before anything is copied, and keeps one style per editor", () => {
    const core = setup();
    core.select(["b"]);
    expect(pasteStyleToSelection(core)).toBe(false);
    expect(core.getState().notice).toBe("Copy a style first.");
    const other = setup();
    other.select(["a"]);
    copyStyleOfSelection(other);
    expect(hasCopiedStyle(core)).toBe(false);
  });

  it("keeps the copied style as it was when the source layer changes later", () => {
    const core = setup();
    core.select(["a"]);
    copyStyleOfSelection(core);
    core.dispatch({ type: "update", id: "a", patch: { opacity: 0.1 } });
    core.select(["b"]);
    pasteStyleToSelection(core);
    expect(core.doc.nodes.b!.opacity).toBe(0.5);
  });
});

describe("shortcuts", () => {
  const key = (k: string, o: Partial<KeyInput> = {}): KeyInput => ({ key: k, mod: false, shift: false, alt: false, ...o });
  const flat = () => new EditorCore(docWith([rect("a", { x: 100 }), rect("b", { x: 300 }), rect("c", { x: 500 }), rect("d", { x: 700 })]));

  it("Ctrl+] and Ctrl+[ move one step", () => {
    const c = flat();
    c.select(["b"]);
    expect(handleKey(c, key("]", { mod: true }))).toBe(true);
    expect(c.doc.root).toEqual(["a", "c", "b", "d"]);
    expect(handleKey(c, key("[", { mod: true }))).toBe(true);
    expect(c.doc.root).toEqual(["a", "b", "c", "d"]);
  });

  it("Ctrl+Shift+] and Ctrl+Shift+[ go to the front and back, as the bracket or as the brace", () => {
    const c = flat();
    c.select(["b"]);
    expect(handleKey(c, key("]", { mod: true, shift: true }))).toBe(true);
    expect(c.doc.root).toEqual(["a", "c", "d", "b"]);
    expect(handleKey(c, key("{", { mod: true, shift: true }))).toBe(true);
    expect(c.doc.root).toEqual(["b", "a", "c", "d"]);
    expect(handleKey(c, key("}", { mod: true, shift: true }))).toBe(true);
    expect(c.doc.root).toEqual(["a", "c", "d", "b"]);
    expect(handleKey(c, key("[", { mod: true, shift: true }))).toBe(true);
    expect(c.doc.root).toEqual(["b", "a", "c", "d"]);
  });

  it("uses the bracket keys even with nothing selected, and says why nothing happened", () => {
    const c = flat();
    expect(handleKey(c, key("]", { mod: true }))).toBe(true);
    expect(c.getState().notice).toBe("Select a layer first.");
  });

  it("Alt+Shift+L toggles the lock, in either case of letter", () => {
    const c = flat();
    c.select(["a"]);
    expect(handleKey(c, key("L", { alt: true, shift: true }))).toBe(true);
    expect(c.doc.nodes.a!.lock).toBe("locked");
    expect(handleKey(c, key("l", { alt: true, shift: true }))).toBe(true);
    expect(c.doc.nodes.a!.lock).toBe("free");
  });

  it("Ctrl+Alt+C and Ctrl+Alt+V copy and paste a style, and leave the document alone when copying", () => {
    const c = new EditorCore(docWith([{ ...rect("a", {}), opacity: 0.25 }, rect("b", { x: 300 })]));
    c.select(["a"]);
    const before = c.doc;
    expect(handleKey(c, key("c", { mod: true, alt: true }))).toBe(true);
    expect(c.doc).toBe(before);
    expect(hasCopiedStyle(c)).toBe(true);
    c.select(["b"]);
    expect(handleKey(c, key("v", { mod: true, alt: true }))).toBe(true);
    expect(c.doc.nodes.b!.opacity).toBe(0.25);
  });

  it("does not take plain Ctrl+C or Ctrl+V (those stay with the clipboard), nor the near misses", () => {
    const c = flat();
    c.select(["b"]);
    expect(handleKey(c, key("c", { mod: true }))).toBe(false);
    expect(handleKey(c, key("v", { mod: true }))).toBe(false);
    expect(hasCopiedStyle(c)).toBe(false);
    expect(handleKey(c, key("c", { mod: true, alt: true, shift: true }))).toBe(false);
    expect(handleKey(c, key("]", { mod: true, alt: true }))).toBe(false);
    expect(handleKey(c, key("l", { alt: true }))).toBe(false);
    expect(handleKey(c, key("l", { mod: true, alt: true, shift: true }))).toBe(false);
    expect(handleKey(c, key("]"))).toBe(false);
    expect(c.doc.root).toEqual(["a", "b", "c", "d"]);
    expect(c.doc.nodes.b!.lock).toBe("free");
  });
});

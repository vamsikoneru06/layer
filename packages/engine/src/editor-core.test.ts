import { describe, expect, it } from "vitest";
import { EditorCore } from "./editor-core";
import { docWith, rect, text } from "./test-docs";

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

  it("keeps the same selection array while only chrome such as hover changes", () => {
    const c = core();
    c.select(["a"]);
    const selection = c.getState().selection;
    c.setChrome({ hover: "a" });
    expect(c.getState().selection).toBe(selection);
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

describe("EditorCore text editing", () => {
  const textCore = () =>
    new EditorCore(
      docWith([
        text("t", { x: 200 }, "Hello"),
        { ...text("co", { x: 400 }, "Name"), lock: "content-only", maxChars: 8 },
        { ...text("locked", { x: 600 }, "Fixed"), lock: "locked" },
        rect("r", {}),
      ]),
    );

  it("commits a whole typing session as one undo step", () => {
    const c = textCore();
    expect(c.startTextEdit("t")).toBe(true);
    expect(c.getState()).toMatchObject({ editing: "t", selection: ["t"] });
    c.editText("Hello,");
    c.editText("Hello, world");
    expect(c.getState().doc.nodes.t).toMatchObject({ content: "Hello, world" });
    c.endTextEdit(true);
    expect(c.getState().editing).toBeNull();
    c.undo();
    expect(c.getState().doc.nodes.t).toMatchObject({ content: "Hello" });
  });

  it("restores the text on cancel and records nothing", () => {
    const c = textCore();
    c.startTextEdit("t");
    c.editText("Nope");
    c.endTextEdit(false);
    expect(c.getState().doc.nodes.t).toMatchObject({ content: "Hello" });
    expect(c.getState().canUndo).toBe(false);
  });

  it("edits content-only layers, cut to maxChars, but refuses locked layers and non-text", () => {
    const c = textCore();
    expect(c.startTextEdit("co")).toBe(true);
    c.editText("A much longer name");
    c.endTextEdit(true);
    expect(c.getState().doc.nodes.co).toMatchObject({ content: "A much l" });

    expect(c.startTextEdit("locked")).toBe(false);
    expect(c.getState().notice).toMatch(/locked/i);
    expect(c.startTextEdit("r")).toBe(false);
    expect(c.getState().editing).toBeNull();
  });

  it("counts maxChars in visible characters and never keeps half of an emoji or a conjunct", () => {
    const c = textCore();
    c.startTextEdit("co");
    c.editText("Party 🧑🏽‍💻🎉!"); // 9 visible characters; the 8th is a four-code-point emoji
    expect(c.getState().doc.nodes.co).toMatchObject({ content: "Party 🧑🏽‍💻🎉" });
    c.editText("స్వాగతం మిత్రులారా!"); // Telugu: 3 + 1 + 4 + 1 visible characters, 19 code units
    const kept = (c.getState().doc.nodes.co as { content: string }).content;
    expect(kept).toBe("స్వాగతం మిత్రులారా");
    expect(kept).not.toMatch(/[\uD800-\uDFFF]/);
  });

  it("allows locked text in Author Mode", () => {
    const c = new EditorCore(docWith([{ ...text("locked", {}, "Fixed"), lock: "locked" }]), { mode: "template" });
    expect(c.startTextEdit("locked")).toBe(true);
  });
});

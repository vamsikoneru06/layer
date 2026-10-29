import { EditorCore, ZOOM_MAX } from "@vash/engine";
import { createEmptyDoc, type Doc, type ShapeNode } from "@vash/schema";
import { describe, expect, it, vi } from "vitest";
import { ACTION_IDS, buildActions, CONTEXT_LAYOUTS, formatShortcut, MENUS, toMenuItems, type ActionHost } from "./editor-actions";

function rect(id: string, x: number, lock: ShapeNode["lock"] = "free"): ShapeNode {
  return {
    id,
    type: "shape",
    name: id,
    transform: { x, y: 100, rotation: 0, scaleX: 1, scaleY: 1 },
    width: 100,
    height: 100,
    opacity: 1,
    visible: true,
    lock,
    geometry: { kind: "rect", cornerRadius: 0 },
    fill: { type: "solid", color: "#FF0000" },
    stroke: null,
  };
}

function docOf(nodes: ShapeNode[]): Doc {
  const doc = createEmptyDoc({ id: "d1", kind: "design", title: "Test", format: "custom", size: { width: 1000, height: 1000 } });
  for (const n of nodes) doc.nodes[n.id] = n;
  doc.root = nodes.map((n) => n.id);
  return doc;
}

const host = (over: Partial<ActionHost> = {}): ActionHost => ({
  panelsHidden: false,
  canFullscreen: true,
  local: false,
  copy: vi.fn(),
  cut: vi.fn(),
  paste: vi.fn(),
  newDesign: vi.fn(),
  open: vi.fn(),
  makeCopy: vi.fn(),
  rename: vi.fn(),
  moveToFolder: vi.fn(),
  designInfo: vi.fn(),
  save: vi.fn(),
  download: vi.fn(),
  zoomIn: vi.fn(),
  zoomOut: vi.fn(),
  fit: vi.fn(),
  fullscreen: vi.fn(),
  togglePanels: vi.fn(),
  shortcuts: vi.fn(),
  ...over,
});
const actionsFor = (core: EditorCore, h = host()) => buildActions(core.getState(), core, h);

describe("formatShortcut", () => {
  it("spells out modifiers on Windows and Linux", () => {
    expect(formatShortcut("mod+shift+g", false)).toBe("Ctrl+Shift+G");
    expect(formatShortcut("delete", false)).toBe("Delete");
    expect(formatShortcut("shift+arrows", false)).toBe("Shift+Arrow keys");
  });

  it("uses symbols on a Mac", () => {
    expect(formatShortcut("mod+shift+g", true)).toBe("⌘⇧G");
    expect(formatShortcut("mod+s", true)).toBe("⌘S");
  });
});

describe("the registry", () => {
  it("has an action for every id, and every menu entry is one of them (no dead items)", () => {
    const actions = actionsFor(new EditorCore(docOf([rect("a", 100)])));
    for (const id of ACTION_IDS) {
      expect(actions[id], id).toBeDefined();
      expect(typeof actions[id].run, id).toBe("function");
    }
    for (const layout of [...Object.values(MENUS), ...Object.values(CONTEXT_LAYOUTS)]) {
      for (const entry of layout) if (entry !== "separator") expect(ACTION_IDS, entry).toContain(entry);
    }
  });

  it("disables what needs a selection, with a reason", () => {
    const a = actionsFor(new EditorCore(docOf([rect("a", 100)])));
    for (const id of ["copy", "cut", "delete", "duplicate", "group", "ungroup"] as const) expect(a[id].disabled, id).toBeTruthy();
    expect(a.copy.disabled).toBe("Select a layer first.");
    expect(a.paste.disabled).toBeUndefined();
  });

  it("enables editing actions for a selection and grouping for two layers", () => {
    const core = new EditorCore(docOf([rect("a", 100), rect("b", 300)]));
    core.select(["a"]);
    const one = actionsFor(core);
    expect(one.copy.disabled).toBeUndefined();
    expect(one.duplicate.disabled).toBeUndefined();
    expect(one.group.disabled).toMatch(/two or more/);
    core.select(["a", "b"]);
    expect(actionsFor(core).group.disabled).toBeUndefined();
  });

  it("refuses cut and delete on a locked layer with the template's reason (Review Focus 4)", () => {
    const core = new EditorCore(docOf([rect("locked", 100, "locked")]));
    core.select(["locked"]);
    const a = actionsFor(core);
    expect(a.cut.disabled).toMatch(/locked/i);
    expect(a.delete.disabled).toMatch(/locked/i);
    expect(a.copy.disabled).toBeUndefined();
  });

  it("tracks undo and redo", () => {
    const core = new EditorCore(docOf([rect("a", 100)]));
    expect(actionsFor(core).undo.disabled).toBe("Nothing to undo.");
    core.dispatch({ type: "meta", patch: { title: "New" } });
    expect(actionsFor(core).undo.disabled).toBeUndefined();
    expect(actionsFor(core).redo.disabled).toBe("Nothing to redo.");
  });

  it("disables zoom in at the largest zoom", () => {
    const core = new EditorCore(docOf([]));
    core.setChrome({ viewport: { zoom: ZOOM_MAX, panX: 0, panY: 0 } });
    expect(actionsFor(core).zoomIn.disabled).toBeTruthy();
    expect(actionsFor(core).zoomOut.disabled).toBeUndefined();
  });

  it("runs the same code as the keyboard", () => {
    const core = new EditorCore(docOf([rect("a", 100), rect("b", 300)]));
    core.select(["a", "b"]);
    actionsFor(core).group.run();
    expect(core.doc.root).toHaveLength(1);
    actionsFor(core).ungroup.run();
    expect(core.doc.root).toEqual(["a", "b"]);
    core.select(["a"]);
    actionsFor(core).duplicate.run();
    expect(core.doc.root).toHaveLength(3);
    actionsFor(core).delete.run();
    expect(core.doc.root).toHaveLength(2);
    actionsFor(core).selectAll.run();
    expect(core.getState().selection).toEqual(core.doc.root);
  });

  it("hands clipboard and file actions to the host", () => {
    const h = host();
    const a = actionsFor(new EditorCore(docOf([])), h);
    a.copy.run();
    a.paste.run();
    a.makeCopy.run();
    a.rename.run();
    expect(h.copy).toHaveBeenCalledOnce();
    expect(h.paste).toHaveBeenCalledOnce();
    expect(h.makeCopy).toHaveBeenCalledOnce();
    expect(h.rename).toHaveBeenCalledOnce();
  });

  it("labels the panels toggle for what it will do, and hides Fullscreen where it is unsupported", () => {
    const core = new EditorCore(docOf([]));
    expect(actionsFor(core).togglePanels.label).toBe("Hide panels");
    expect(actionsFor(core, host({ panelsHidden: true })).togglePanels.label).toBe("Show panels");
    expect(actionsFor(core, host({ canFullscreen: false })).fullscreen.hidden).toBe(true);
  });

  it("offers folders only for designs in an account", () => {
    const core = new EditorCore(docOf([]));
    expect(actionsFor(core).moveToFolder.disabled).toBeUndefined();
    expect(actionsFor(core, host({ local: true })).moveToFolder.disabled).toBe("Folders need an account. Use Save to account first.");
  });
});

describe("toMenuItems", () => {
  it("adds shortcut labels and passes the disabled reason through", () => {
    const actions = actionsFor(new EditorCore(docOf([rect("a", 100)])));
    const items = toMenuItems(actions, ["undo", "copy"], false);
    expect(items[1]).toMatchObject({ label: "Copy", shortcut: "Ctrl+C", disabled: "Select a layer first." });
    expect(toMenuItems(actions, ["copy"], true)[0]).toMatchObject({ shortcut: "⌘C" });
  });

  it("drops hidden actions without leaving stray separators", () => {
    const actions = actionsFor(new EditorCore(docOf([])), host({ canFullscreen: false }));
    expect(toMenuItems(actions, ["fit", "separator", "fullscreen"], false).map((i) => (i === "separator" ? "-" : i.label))).toEqual(["Fit to screen"]);
    expect(toMenuItems(actions, ["separator", "fit", "separator", "separator", "togglePanels"], false).map((i) => (i === "separator" ? "-" : i.label))).toEqual(["Fit to screen", "-", "Hide panels"]);
  });
});

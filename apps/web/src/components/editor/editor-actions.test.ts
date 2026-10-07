import { EditorCore, ZOOM_MAX } from "@vash/engine";
import { createEmptyDoc, type Doc, type ShapeNode } from "@vash/schema";
import { describe, expect, it, vi } from "vitest";
import { actionTitle, ACTION_IDS, buildActions, CONTEXT_LAYOUTS, formatShortcut, MENUS, SHORTCUT_ACTIONS, SHORTCUT_NAMES, toMenuItems, type ActionHost } from "./editor-actions";

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

  it("shows the bracket keys as they are, and Alt as Alt or Option", () => {
    expect(formatShortcut("mod+]", false)).toBe("Ctrl+]");
    expect(formatShortcut("mod+shift+[", false)).toBe("Ctrl+Shift+[");
    expect(formatShortcut("mod+shift+]", true)).toBe("⌘⇧]");
    expect(formatShortcut("mod+[", true)).toBe("⌘[");
    expect(formatShortcut("alt+shift+l", false)).toBe("Alt+Shift+L");
    expect(formatShortcut("alt+shift+l", true)).toBe("⌥⇧L");
    expect(formatShortcut("mod+alt+c", false)).toBe("Ctrl+Alt+C");
    expect(formatShortcut("mod+alt+v", true)).toBe("⌘⌥V");
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

const NEW_IDS = [
  "bringForward",
  "bringToFront",
  "sendBackward",
  "sendToBack",
  "alignLeft",
  "alignCenter",
  "alignRight",
  "alignTop",
  "alignMiddle",
  "alignBottom",
  "distributeHorizontal",
  "distributeVertical",
  "flipHorizontal",
  "flipVertical",
  "toggleLock",
  "copyStyle",
  "pasteStyle",
] as const;

const labels = (items: ReturnType<typeof toMenuItems>) => items.map((i) => (i === "separator" ? "-" : i.label));

describe("object controls", () => {
  it("labels and shortcuts follow the spec", () => {
    const a = actionsFor(new EditorCore(docOf([rect("a", 100)])));
    expect(NEW_IDS.map((id) => a[id].label)).toEqual([
      "Bring forward",
      "Bring to front",
      "Send backward",
      "Send to back",
      "Align left",
      "Align centre",
      "Align right",
      "Align top",
      "Align middle",
      "Align bottom",
      "Distribute horizontally",
      "Distribute vertically",
      "Flip horizontal",
      "Flip vertical",
      "Lock",
      "Copy style",
      "Paste style",
    ]);
    expect(NEW_IDS.map((id) => a[id].shortcut)).toEqual([
      "mod+]",
      "mod+shift+]",
      "mod+[",
      "mod+shift+[",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      "alt+shift+l",
      "mod+alt+c",
      "mod+alt+v",
    ]);
  });

  it("explains why each is off when nothing is selected", () => {
    const a = actionsFor(new EditorCore(docOf([rect("a", 100)])));
    for (const id of ["bringForward", "bringToFront", "sendBackward", "sendToBack", "alignLeft", "alignCenter", "alignRight", "alignTop", "alignMiddle", "alignBottom", "flipHorizontal", "flipVertical", "toggleLock"] as const) {
      expect(a[id].disabled, id).toBe("Select a layer first.");
    }
    expect(a.distributeHorizontal.disabled).toBe("Select three or more layers to distribute.");
    expect(a.distributeVertical.disabled).toBe("Select three or more layers to distribute.");
    expect(a.copyStyle.disabled).toBe("Select one layer to copy its style.");
    expect(a.pasteStyle.disabled).toBe("Copy a style first.");
  });

  it("enables what can run, and gives the plan's reason for what cannot", () => {
    const core = new EditorCore(docOf([rect("a", 100), rect("b", 300), rect("c", 700)]));
    core.select(["a"]);
    const one = actionsFor(core);
    for (const id of ["bringForward", "bringToFront", "alignLeft", "alignCenter", "alignTop", "flipHorizontal", "flipVertical", "toggleLock", "copyStyle"] as const) {
      expect(one[id].disabled, id).toBeUndefined();
    }
    expect(one.sendBackward.disabled).toBe("Already at the back.");
    expect(one.sendToBack.disabled).toBe("Already at the back.");
    expect(one.distributeHorizontal.disabled).toBe("Select three or more layers to distribute.");

    core.select(["a", "b", "c"]);
    const three = actionsFor(core);
    expect(three.distributeHorizontal.disabled).toBeUndefined();
    expect(three.bringToFront.disabled).toBe("Already at the front.");
    expect(three.copyStyle.disabled).toBe("Select one layer to copy its style.");
  });

  it("says Already aligned once the layer is where the edge is", () => {
    const core = new EditorCore(docOf([rect("a", 50)]));
    core.select(["a"]);
    expect(actionsFor(core).alignLeft.disabled).toBe("Already aligned.");
  });

  it("runs order, align, distribute and flip as one undo step each", () => {
    const core = new EditorCore(docOf([rect("a", 100), rect("b", 300), rect("c", 700)]));
    core.select(["a"]);
    actionsFor(core).bringToFront.run();
    expect(core.doc.root).toEqual(["b", "c", "a"]);
    core.undo();
    expect(core.doc.root).toEqual(["a", "b", "c"]);

    actionsFor(core).alignLeft.run();
    expect(core.doc.nodes.a!.transform.x).toBe(50);
    core.undo();
    expect(core.doc.nodes.a!.transform.x).toBe(100);

    actionsFor(core).flipHorizontal.run();
    expect(core.doc.nodes.a!.transform.scaleX).toBe(-1);
    core.undo();

    core.select(["a", "b", "c"]);
    actionsFor(core).distributeHorizontal.run();
    expect(core.doc.nodes.b!.transform.x).toBe(400);
    core.undo();
    expect(core.doc.nodes.b!.transform.x).toBe(300);
  });

  it("switches Lock and Unlock with the selection, and the lock policy still decides", () => {
    const core = new EditorCore(docOf([rect("a", 100), rect("b", 300, "locked")]));
    core.select(["a"]);
    expect(actionsFor(core).toggleLock.label).toBe("Lock");
    actionsFor(core).toggleLock.run();
    expect(core.doc.nodes.a!.lock).toBe("locked");
    expect(actionsFor(core).toggleLock.label).toBe("Unlock");
    actionsFor(core).toggleLock.run();
    expect(core.doc.nodes.a!.lock).toBe("free");

    core.select(["a", "b"]);
    expect(actionsFor(core).toggleLock.label).toBe("Unlock");
    core.select(["b"]);
    expect(actionsFor(core).alignLeft.disabled).toMatch(/lock/i);
  });

  it("pastes a copied style only after one was copied", () => {
    const core = new EditorCore(docOf([rect("a", 100), rect("b", 300)]));
    core.dispatch({ type: "update", id: "a", patch: { opacity: 0.4 } });
    core.select(["a"]);
    expect(actionsFor(core).pasteStyle.disabled).toBe("Copy a style first.");
    actionsFor(core).copyStyle.run();
    core.select(["b"]);
    expect(actionsFor(core).pasteStyle.disabled).toBeUndefined();
    actionsFor(core).pasteStyle.run();
    expect(core.doc.nodes.b!.opacity).toBe(0.4);
    core.undo();
    expect(core.doc.nodes.b!.opacity).toBe(1);
  });

  it("keeps a copied style per editor", () => {
    const one = new EditorCore(docOf([rect("a", 100)]));
    const two = new EditorCore(docOf([rect("a", 100)]));
    one.select(["a"]);
    two.select(["a"]);
    actionsFor(one).copyStyle.run();
    expect(actionsFor(one).pasteStyle.disabled).toBeUndefined();
    expect(actionsFor(two).pasteStyle.disabled).toBe("Copy a style first.");
  });

  it("lays out the Arrange menu between Edit and View, as the spec lists it", () => {
    expect(Object.keys(MENUS)).toEqual(["file", "edit", "arrange", "view", "help"]);
    const a = actionsFor(new EditorCore(docOf([rect("a", 100)])));
    expect(labels(toMenuItems(a, MENUS.arrange, false))).toEqual([
      "Bring forward",
      "Bring to front",
      "Send backward",
      "Send to back",
      "-",
      "Align left",
      "Align centre",
      "Align right",
      "Align top",
      "Align middle",
      "Align bottom",
      "-",
      "Distribute horizontally",
      "Distribute vertically",
      "-",
      "Flip horizontal",
      "Flip vertical",
      "-",
      "Lock",
    ]);
  });

  it("puts Copy style and Paste style after Paste in the Edit menu", () => {
    const a = actionsFor(new EditorCore(docOf([rect("a", 100)])));
    const edit = labels(toMenuItems(a, MENUS.edit, false));
    expect(edit.slice(edit.indexOf("Paste"), edit.indexOf("Paste") + 3)).toEqual(["Paste", "Copy style", "Paste style"]);
  });

  it("adds the style, order, flip and lock items to the right-click menu on a layer, not on the canvas", () => {
    const a = actionsFor(new EditorCore(docOf([rect("a", 100)])));
    expect(labels(toMenuItems(a, CONTEXT_LAYOUTS.node, false))).toEqual([
      "Cut",
      "Copy",
      "Paste",
      "Duplicate",
      "Delete",
      "-",
      "Group",
      "Ungroup",
      "-",
      "Copy style",
      "Paste style",
      "-",
      "Bring forward",
      "Bring to front",
      "Send backward",
      "Send to back",
      "-",
      "Flip horizontal",
      "Flip vertical",
      "Lock",
    ]);
    expect(labels(toMenuItems(a, CONTEXT_LAYOUTS.canvas, false))).toEqual(["Paste", "Select all"]);
  });

  it("passes the new shortcuts to the menus and lists them in the shortcuts dialog", () => {
    const a = actionsFor(new EditorCore(docOf([rect("a", 100)])));
    expect(toMenuItems(a, ["bringToFront", "toggleLock"], false)).toMatchObject([{ shortcut: "Ctrl+Shift+]" }, { shortcut: "Alt+Shift+L" }]);
    for (const id of NEW_IDS) if (a[id].shortcut) expect(SHORTCUT_ACTIONS, id).toContain(id);
    for (const id of SHORTCUT_ACTIONS) expect(a[id].shortcut, id).toBeTruthy();
    // The dialog names Lock by what the key does, not by what the current selection would do.
    expect(SHORTCUT_NAMES.toggleLock).toBe("Lock or unlock");
  });

  it("titles a button with its shortcut, or with why it is off", () => {
    const core = new EditorCore(docOf([rect("a", 100), rect("b", 300)]));
    expect(actionTitle(actionsFor(core).bringToFront, false)).toBe("Select a layer first.");
    core.select(["a"]);
    const a = actionsFor(core);
    expect(actionTitle(a.bringToFront, false)).toBe("Bring to front (Ctrl+Shift+])");
    expect(actionTitle(a.bringToFront, true)).toBe("Bring to front (⌘⇧])");
    expect(actionTitle(a.alignLeft, false)).toBe("Align left");
    expect(actionTitle(a.sendToBack, false)).toBe("Already at the back.");
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

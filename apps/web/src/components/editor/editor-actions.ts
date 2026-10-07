import {
  alignSelection,
  checkPolicy,
  copiedStyleOf,
  copyStyleOfSelection,
  distributeSelection,
  duplicateSelection,
  flipSelection,
  groupSelection,
  handleKey,
  lockLabel,
  pasteStyleToSelection,
  planAlign,
  planDistribute,
  planDuplicate,
  planFlip,
  planGroup,
  planPasteStyle,
  planReorder,
  planToggleLock,
  planUngroup,
  reorderSelection,
  toggleLockSelection,
  ungroupSelection,
  ZOOM_MAX,
  ZOOM_MIN,
  type AlignEdge,
  type Axis,
  type Command,
  type EditorCore,
  type EditorState,
  type Plan,
  type ReorderTarget,
} from "@vash/engine";
import type { MenuItem } from "@/components/ui/menu";

export const ACTION_IDS = [
  "undo",
  "redo",
  "cut",
  "copy",
  "paste",
  "duplicate",
  "delete",
  "selectAll",
  "group",
  "ungroup",
  "copyStyle",
  "pasteStyle",
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
  "newDesign",
  "open",
  "makeCopy",
  "rename",
  "moveToFolder",
  "designInfo",
  "save",
  "download",
  "zoomIn",
  "zoomOut",
  "fit",
  "fullscreen",
  "togglePanels",
  "shortcuts",
] as const;

export type ActionId = (typeof ACTION_IDS)[number];

export interface Action {
  id: ActionId;
  label: string;
  /** A spec such as "mod+shift+g", shown next to the item. The key itself is handled elsewhere. */
  shortcut?: string;
  /** Why the action cannot run right now. Absent when it can. */
  disabled?: string;
  /** Not offered at all, for example Fullscreen in a browser without it. */
  hidden?: boolean;
  run: () => void;
}

/** What the editor screen provides: the actions that need the router, dialogs, the clipboard or the browser. */
export interface ActionHost {
  panelsHidden: boolean;
  canFullscreen: boolean;
  /** A guest design kept in this browser: folders need an account. */
  local: boolean;
  copy(): void;
  cut(): void;
  paste(): void;
  newDesign(): void;
  open(): void;
  makeCopy(): void;
  rename(): void;
  moveToFolder(): void;
  designInfo(): void;
  save(): void;
  download(): void;
  zoomIn(): void;
  zoomOut(): void;
  fit(): void;
  fullscreen(): void;
  togglePanels(): void;
  shortcuts(): void;
}

const DELETE_KEY = { key: "Delete", mod: false, shift: false, alt: false } as const;
const reasonOf = (plan: Plan): string | undefined => (plan.ok ? undefined : plan.reason);

const ORDER = [
  ["bringForward", "Bring forward", "forward", "mod+]"],
  ["bringToFront", "Bring to front", "front", "mod+shift+]"],
  ["sendBackward", "Send backward", "backward", "mod+["],
  ["sendToBack", "Send to back", "back", "mod+shift+["],
] as const satisfies readonly (readonly [ActionId, string, ReorderTarget, string])[];
const ALIGN = [
  ["alignLeft", "Align left", "left"],
  ["alignCenter", "Align centre", "center"],
  ["alignRight", "Align right", "right"],
  ["alignTop", "Align top", "top"],
  ["alignMiddle", "Align middle", "middle"],
  ["alignBottom", "Align bottom", "bottom"],
] as const satisfies readonly (readonly [ActionId, string, AlignEdge])[];
const DISTRIBUTE = [
  ["distributeHorizontal", "Distribute horizontally", "horizontal"],
  ["distributeVertical", "Distribute vertically", "vertical"],
] as const satisfies readonly (readonly [ActionId, string, Axis])[];
const FLIP = [
  ["flipHorizontal", "Flip horizontal", "horizontal"],
  ["flipVertical", "Flip vertical", "vertical"],
] as const satisfies readonly (readonly [ActionId, string, Axis])[];

/** Every editor action with its current enabled state. Rebuilt whenever the editor state changes. */
export function buildActions(state: EditorState, core: EditorCore, host: ActionHost): Record<ActionId, Action> {
  const { doc, selection } = state;
  const needsSelection = selection.length === 0 ? "Select a layer first." : undefined;
  const deleteRefusal = (): string | undefined => {
    if (needsSelection) return needsSelection;
    const command: Command = { type: "batch", commands: selection.map((id): Command => ({ type: "delete", id })) };
    const verdict = checkPolicy(doc, command, state.mode);
    return verdict.ok ? undefined : verdict.reason;
  };

  const list: Action[] = [
    { id: "undo", label: "Undo", shortcut: "mod+z", disabled: state.canUndo ? undefined : "Nothing to undo.", run: () => core.undo() },
    { id: "redo", label: "Redo", shortcut: "mod+shift+z", disabled: state.canRedo ? undefined : "Nothing to redo.", run: () => core.redo() },
    { id: "cut", label: "Cut", shortcut: "mod+x", disabled: deleteRefusal(), run: host.cut },
    { id: "copy", label: "Copy", shortcut: "mod+c", disabled: needsSelection, run: host.copy },
    { id: "paste", label: "Paste", shortcut: "mod+v", run: host.paste },
    { id: "duplicate", label: "Duplicate", shortcut: "mod+d", disabled: reasonOf(planDuplicate(doc, selection, state.mode)), run: () => void duplicateSelection(core) },
    { id: "delete", label: "Delete", shortcut: "delete", disabled: deleteRefusal(), run: () => void handleKey(core, DELETE_KEY) },
    { id: "selectAll", label: "Select all", shortcut: "mod+a", disabled: doc.root.length === 0 ? "Nothing to select." : undefined, run: () => core.select(core.doc.root) },
    { id: "group", label: "Group", shortcut: "mod+g", disabled: reasonOf(planGroup(doc, selection, state.mode)), run: () => void groupSelection(core) },
    { id: "ungroup", label: "Ungroup", shortcut: "mod+shift+g", disabled: reasonOf(planUngroup(doc, selection, state.mode)), run: () => void ungroupSelection(core) },
    { id: "copyStyle", label: "Copy style", shortcut: "mod+alt+c", disabled: selection.length === 1 ? undefined : "Select one layer to copy its style.", run: () => void copyStyleOfSelection(core) },
    { id: "pasteStyle", label: "Paste style", shortcut: "mod+alt+v", disabled: reasonOf(planPasteStyle(doc, selection, state.mode, copiedStyleOf(core))), run: () => void pasteStyleToSelection(core) },
    ...ORDER.map(([id, label, where, shortcut]): Action => ({ id, label, shortcut, disabled: reasonOf(planReorder(doc, selection, state.mode, where)), run: () => void reorderSelection(core, where) })),
    ...ALIGN.map(([id, label, edge]): Action => ({ id, label, disabled: reasonOf(planAlign(doc, selection, state.mode, edge)), run: () => void alignSelection(core, edge) })),
    ...DISTRIBUTE.map(([id, label, axis]): Action => ({ id, label, disabled: reasonOf(planDistribute(doc, selection, state.mode, axis)), run: () => void distributeSelection(core, axis) })),
    ...FLIP.map(([id, label, axis]): Action => ({ id, label, disabled: reasonOf(planFlip(doc, selection, state.mode, axis)), run: () => void flipSelection(core, axis) })),
    { id: "toggleLock", label: lockLabel(doc, selection), shortcut: "alt+shift+l", disabled: reasonOf(planToggleLock(doc, selection, state.mode)), run: () => void toggleLockSelection(core) },
    { id: "newDesign", label: "New design", run: host.newDesign },
    { id: "open", label: "Open", run: host.open },
    { id: "makeCopy", label: "Make a copy", run: host.makeCopy },
    { id: "rename", label: "Rename", run: host.rename },
    { id: "moveToFolder", label: "Move to folder", disabled: host.local ? "Folders need an account. Use Save to account first." : undefined, run: host.moveToFolder },
    { id: "designInfo", label: "Design info", run: host.designInfo },
    { id: "save", label: "Save", shortcut: "mod+s", run: host.save },
    { id: "download", label: "Download", run: host.download },
    { id: "zoomIn", label: "Zoom in", disabled: state.viewport.zoom >= ZOOM_MAX - 1e-9 ? "Already at the largest zoom." : undefined, run: host.zoomIn },
    { id: "zoomOut", label: "Zoom out", disabled: state.viewport.zoom <= ZOOM_MIN + 1e-9 ? "Already at the smallest zoom." : undefined, run: host.zoomOut },
    { id: "fit", label: "Fit to screen", run: host.fit },
    { id: "fullscreen", label: "Fullscreen", hidden: !host.canFullscreen, run: host.fullscreen },
    { id: "togglePanels", label: host.panelsHidden ? "Show panels" : "Hide panels", run: host.togglePanels },
    { id: "shortcuts", label: "Keyboard shortcuts", run: host.shortcuts },
  ];
  return Object.fromEntries(list.map((a) => [a.id, a])) as Record<ActionId, Action>;
}

type Layout = readonly (ActionId | "separator")[];

export const MENUS = {
  file: ["newDesign", "open", "makeCopy", "separator", "rename", "moveToFolder", "designInfo", "separator", "save", "download"],
  edit: ["undo", "redo", "separator", "cut", "copy", "paste", "copyStyle", "pasteStyle", "duplicate", "delete", "separator", "selectAll", "group", "ungroup"],
  arrange: [
    "bringForward",
    "bringToFront",
    "sendBackward",
    "sendToBack",
    "separator",
    "alignLeft",
    "alignCenter",
    "alignRight",
    "alignTop",
    "alignMiddle",
    "alignBottom",
    "separator",
    "distributeHorizontal",
    "distributeVertical",
    "separator",
    "flipHorizontal",
    "flipVertical",
    "separator",
    "toggleLock",
  ],
  view: ["zoomIn", "zoomOut", "fit", "separator", "fullscreen", "togglePanels"],
  help: ["shortcuts"],
} as const satisfies Record<string, Layout>;

export const CONTEXT_LAYOUTS = {
  node: [
    "cut",
    "copy",
    "paste",
    "duplicate",
    "delete",
    "separator",
    "group",
    "ungroup",
    "separator",
    "copyStyle",
    "pasteStyle",
    "separator",
    "bringForward",
    "bringToFront",
    "sendBackward",
    "sendToBack",
    "separator",
    "flipHorizontal",
    "flipVertical",
    "toggleLock",
  ],
  canvas: ["paste", "selectAll"],
} as const satisfies Record<string, Layout>;

const KEY_NAMES: Record<string, string> = { arrows: "Arrow keys", escape: "Esc" };

/** "mod+shift+g" as "Ctrl+Shift+G", or "⌘⇧G" on a Mac. */
export function formatShortcut(spec: string, mac: boolean): string {
  const parts = spec.split("+");
  const key = parts.pop()!;
  const label = KEY_NAMES[key] ?? (key.length === 1 ? key.toUpperCase() : key[0]!.toUpperCase() + key.slice(1));
  const modifiers: Record<string, string> = mac ? { mod: "⌘", shift: "⇧", alt: "⌥" } : { mod: "Ctrl", shift: "Shift", alt: "Alt" };
  const lead = parts.map((p) => modifiers[p] ?? p);
  return mac ? [...lead, label].join("") : [...lead, label].join("+");
}

/** Tooltip for an action's button: why it can't run, or its name and shortcut. */
export function actionTitle(a: Action, mac: boolean): string {
  return a.disabled ?? (a.shortcut ? `${a.label} (${formatShortcut(a.shortcut, mac)})` : a.label);
}

/** Menu rows for a layout. Hidden actions are left out, and no separator is left leading, trailing or doubled. */
export function toMenuItems(actions: Record<ActionId, Action>, layout: Layout, mac: boolean): MenuItem[] {
  const items: MenuItem[] = [];
  for (const entry of layout) {
    if (entry === "separator") {
      if (items.length > 0 && items.at(-1) !== "separator") items.push("separator");
      continue;
    }
    const a = actions[entry];
    if (a.hidden) continue;
    items.push({ label: a.label, onSelect: a.run, shortcut: a.shortcut ? formatShortcut(a.shortcut, mac) : undefined, disabled: a.disabled, danger: entry === "delete" || undefined });
  }
  if (items.at(-1) === "separator") items.pop();
  return items;
}

/** Actions listed in the shortcuts dialog, in order. */
export const SHORTCUT_ACTIONS: readonly ActionId[] = ["undo", "redo", "cut", "copy", "paste", "duplicate", "delete", "selectAll", "group", "ungroup", "copyStyle", "pasteStyle", "bringForward", "bringToFront", "sendBackward", "sendToBack", "toggleLock", "save"];

/** Keys and gestures the canvas handles itself, so they are not actions. */
export const OTHER_SHORTCUTS: readonly { spec: string; does: string }[] = [
  { spec: "arrows", does: "Move the selection 1 px" },
  { spec: "shift+arrows", does: "Move the selection 10 px" },
  { spec: "enter", does: "Edit the selected text" },
  { spec: "escape", does: "Deselect, or show the panels again" },
  { spec: "space", does: "Hold and drag to move around" },
  { spec: "mod+scroll", does: "Zoom in and out" },
];

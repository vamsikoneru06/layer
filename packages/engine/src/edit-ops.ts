import { LIMITS, validateDoc, type NodeId } from "@vash/schema";
import { applyCommand, type Command } from "./commands";
import { planAlign, planDistribute, planFlip, planMoveLayer, planReorder, planToggleLock, type AlignEdge, type Axis, type ReorderTarget } from "./arrange";
import { planCopy, planDuplicate, planPaste } from "./clipboard";
import type { EditorCore } from "./editor-core";
import { checked, refuse, topLevelSelection, type Plan } from "./selection-utils";
import { planGroup, planUngroup } from "./structure";
import { planPasteStyle, styleOf, type Style } from "./style";

export const INVALID_CHANGE = "That change would make the design invalid, so it wasn't made.";

/**
 * Applies a plan as one undo step and selects its result. A refused plan, or one whose result would
 * not pass the document validator, changes nothing and leaves a notice for the UI.
 */
export function runPlan(core: EditorCore, plan: Plan): boolean {
  if (!plan.ok) {
    core.setChrome({ notice: plan.reason });
    return false;
  }
  const result = validateDoc(applyCommand(core.doc, plan.command).doc, { kind: core.doc.kind });
  if (!result.ok) {
    core.setChrome({ notice: INVALID_CHANGE });
    return false;
  }
  if (!core.dispatch(plan.command)) return false;
  core.select(plan.select);
  if (plan.notice) core.setChrome({ notice: plan.notice });
  return true;
}

export const duplicateSelection = (core: EditorCore): boolean => runPlan(core, planDuplicate(core.doc, core.getState().selection, core.mode));
export const groupSelection = (core: EditorCore): boolean => runPlan(core, planGroup(core.doc, core.getState().selection, core.mode));
export const ungroupSelection = (core: EditorCore): boolean => runPlan(core, planUngroup(core.doc, core.getState().selection, core.mode));
export const pasteText = (core: EditorCore, text: string): boolean => runPlan(core, planPaste(core.doc, text, core.mode));

export const reorderSelection = (core: EditorCore, where: ReorderTarget): boolean => runPlan(core, planReorder(core.doc, core.getState().selection, core.mode, where));
export const alignSelection = (core: EditorCore, edge: AlignEdge): boolean => runPlan(core, planAlign(core.doc, core.getState().selection, core.mode, edge));
export const distributeSelection = (core: EditorCore, axis: Axis): boolean => runPlan(core, planDistribute(core.doc, core.getState().selection, core.mode, axis));
export const flipSelection = (core: EditorCore, axis: Axis): boolean => runPlan(core, planFlip(core.doc, core.getState().selection, core.mode, axis));
export const toggleLockSelection = (core: EditorCore): boolean => runPlan(core, planToggleLock(core.doc, core.getState().selection, core.mode));

/** Runs a plan but keeps the current selection, for edits made to a layer that is not necessarily the selected one. */
function runKeepingSelection(core: EditorCore, plan: Plan): boolean {
  return runPlan(core, plan.ok ? { ...plan, select: [...core.getState().selection] } : plan);
}

/** Moves one layer to `index` among its siblings (one undo step) and selects it. */
export const moveLayer = (core: EditorCore, id: NodeId, index: number): boolean => runPlan(core, planMoveLayer(core.doc, id, index, core.mode));

/** The lock toggle for one layer, whatever is selected; the selection stays as it was. */
export const toggleLockOfLayer = (core: EditorCore, id: NodeId): boolean => runKeepingSelection(core, planToggleLock(core.doc, [id], core.mode));

/** Renames a layer (one undo step). The name is trimmed; empty, over-long and multi-line names are refused with a notice. */
export function renameLayer(core: EditorCore, id: NodeId, name: string): boolean {
  const trimmed = name.trim();
  if (!core.doc.nodes[id]) return runKeepingSelection(core, refuse("Select a layer first."));
  if (trimmed === "") return runKeepingSelection(core, refuse("A layer needs a name."));
  if (trimmed.length > LIMITS.nameChars) return runKeepingSelection(core, refuse(`Names can be up to ${LIMITS.nameChars} characters.`));
  if (/[\r\n]/.test(trimmed)) return runKeepingSelection(core, refuse("Names can't contain line breaks."));
  if (trimmed === core.doc.nodes[id]!.name) return true;
  return runKeepingSelection(core, checked(core.doc, { type: "update", id, patch: { name: trimmed } }, core.mode, []));
}

/** The style last copied in each editor. It lives outside the document, so it is not saved and not undoable. */
const copiedStyles = new WeakMap<EditorCore, Style>();

/** The style copied in this editor, or null. */
export const copiedStyleOf = (core: EditorCore): Style | null => copiedStyles.get(core) ?? null;
export const hasCopiedStyle = (core: EditorCore): boolean => copiedStyles.has(core);

/** Remembers the style of the one selected layer and says so. With any other selection it leaves a notice and copies nothing. */
export function copyStyleOfSelection(core: EditorCore): boolean {
  const { selection } = core.getState();
  const node = selection.length === 1 ? core.doc.nodes[selection[0]!] : undefined;
  if (!node) {
    core.setChrome({ notice: "Select one layer to copy its style." });
    return false;
  }
  copiedStyles.set(core, styleOf(node));
  core.setChrome({ notice: "Style copied." }); // also redraws, so the Paste style button enables
  return true;
}

export const pasteStyleToSelection = (core: EditorCore): boolean => runPlan(core, planPasteStyle(core.doc, core.getState().selection, core.mode, copiedStyleOf(core)));

/** Clipboard text for a plan, or null (with a notice when the layers cannot be copied). */
function copyText(core: EditorCore, selection: readonly NodeId[]): string | null {
  const plan = planCopy(core.doc, selection);
  if (!plan) return null;
  if (!plan.ok) core.setChrome({ notice: plan.reason });
  return plan.ok ? plan.text : null;
}

/** Clipboard text for the selection, or null when nothing is selected or the layers cannot be copied. */
export const copySelection = (core: EditorCore): string | null => copyText(core, core.getState().selection);

/** Copies, then deletes. Returns null (and copies nothing) when there is no selection or a lock refuses the delete. */
export function cutSelection(core: EditorCore): string | null {
  const { selection } = core.getState();
  const text = copyText(core, selection);
  if (!text) return null;
  const deletes = topLevelSelection(core.doc, selection).map((id): Command => ({ type: "delete", id }));
  return core.dispatch({ type: "batch", commands: deletes }) ? text : null;
}

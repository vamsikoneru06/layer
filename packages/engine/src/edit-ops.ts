import { validateDoc } from "@vash/schema";
import { applyCommand, type Command } from "./commands";
import { planDuplicate, planPaste, serializeSelection } from "./clipboard";
import type { EditorCore } from "./editor-core";
import { topLevelSelection, type Plan } from "./selection-utils";
import { planGroup, planUngroup } from "./structure";

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

/** Clipboard text for the selection, or null when nothing is selected. */
export const copySelection = (core: EditorCore): string | null => serializeSelection(core.doc, core.getState().selection);

/** Copies, then deletes. Returns null (and copies nothing) when there is no selection or a lock refuses the delete. */
export function cutSelection(core: EditorCore): string | null {
  const { selection } = core.getState();
  const text = serializeSelection(core.doc, selection);
  if (!text) return null;
  const deletes = topLevelSelection(core.doc, selection).map((id): Command => ({ type: "delete", id }));
  return core.dispatch({ type: "batch", commands: deletes }) ? text : null;
}

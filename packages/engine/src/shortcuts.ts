import type { Command } from "./commands";
import { duplicateSelection, groupSelection, ungroupSelection } from "./edit-ops";
import type { EditorCore } from "./editor-core";

/** A key press; `mod` is ⌘ on macOS and Ctrl elsewhere. */
export interface KeyInput {
  key: string;
  mod: boolean;
  shift: boolean;
  alt: boolean;
}

const NUDGE: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

/** Editor shortcuts. Returns true when the key was used (the caller then prevents the browser default). */
export function handleKey(core: EditorCore, e: KeyInput): boolean {
  const { selection, doc } = core.getState();
  const k = e.key.toLowerCase();

  if (e.mod && k === "z") {
    if (e.shift) core.redo();
    else core.undo();
    return true;
  }
  if (e.mod && k === "y") {
    core.redo();
    return true;
  }
  if (e.mod && k === "a") {
    core.select(doc.root);
    return true;
  }
  // With nothing selected these still count as used, so the browser's bookmark (D) and find (G) stay quiet.
  if (e.mod && !e.alt && k === "d" && !e.shift) {
    duplicateSelection(core);
    return true;
  }
  if (e.mod && !e.alt && k === "g") {
    if (e.shift) ungroupSelection(core);
    else groupSelection(core);
    return true;
  }
  if (e.key === "Escape") {
    if (selection.length === 0) return false;
    core.select([]);
    return true;
  }
  if (selection.length === 0) return false;

  if (e.key === "Enter" && !e.mod && selection.length === 1 && doc.nodes[selection[0]!]?.type === "text") {
    core.startTextEdit(selection[0]!);
    return true;
  }
  if (e.key === "Delete" || e.key === "Backspace") {
    core.dispatch({ type: "batch", commands: selection.map((id): Command => ({ type: "delete", id })) });
    return true;
  }
  const nudge = NUDGE[e.key];
  if (nudge) {
    const step = e.shift ? 10 : 1;
    const commands = selection.flatMap((id): Command[] => {
      const t = doc.nodes[id]?.transform;
      return t ? [{ type: "update", id, patch: { transform: { ...t, x: t.x + nudge[0] * step, y: t.y + nudge[1] * step } } }] : [];
    });
    core.dispatch({ type: "batch", commands });
    return true;
  }
  return false;
}

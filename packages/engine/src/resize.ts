import { LIMITS, validateDoc, type Doc } from "@vash/schema";
import { applyCommand, type Command } from "./commands";
import type { EditorCore } from "./editor-core";
import { runPlan } from "./edit-ops";
import type { EditMode } from "./policy";
import { checked, refuse, type Plan } from "./selection-utils";

export interface ArtboardSize {
  width: number;
  height: number;
}

const TOO_EXTREME = "Scaling the content that far would make a layer too large or too small.";

/**
 * Resizes the artboard. With `scaleContent`, every top-level layer is scaled by the smaller of the two
 * ratios and kept centred, so the layout keeps its look; text scales with its layer. Without it, the
 * layers keep their size and position. One batch, so one undo step. The lock policy still applies.
 */
export function planResize(doc: Doc, size: ArtboardSize, mode: EditMode, scaleContent: boolean): Plan {
  const { width, height } = size;
  const { artboardMin: min, artboardMax: max } = LIMITS;
  if (!Number.isInteger(width) || !Number.isInteger(height)) return refuse("Sizes must be whole pixels.");
  if (width < min || width > max || height < min || height > max) return refuse(`Sizes must be between ${min} and ${max} px.`);
  const old = doc.artboard;
  if (width === old.width && height === old.height) return refuse("That's already the size.");

  const s = Math.min(width / old.width, height / old.height);
  const moves: Command[] = !scaleContent
    ? []
    : doc.root.map((id): Command => {
        const t = doc.nodes[id]!.transform;
        return {
          type: "update",
          id,
          patch: {
            transform: { ...t, x: (t.x - old.width / 2) * s + width / 2, y: (t.y - old.height / 2) * s + height / 2, scaleX: t.scaleX * s, scaleY: t.scaleY * s },
          },
        };
      });
  // Layer moves come first, so a locked layer is named by its own reason rather than by the artboard's.
  const command: Command = { type: "batch", commands: [...moves, { type: "artboard", patch: { width, height } }] };
  const verdict = checked(doc, command, mode, []);
  if (!verdict.ok) return verdict;
  // Scaling can push a layer's scale or position past the limits the format allows, so the result is checked too.
  if (!validateDoc(applyCommand(doc, command).doc, { kind: doc.kind }).ok) return refuse(TOO_EXTREME);
  return verdict;
}

/** Resizes the design as one undo step and keeps the selection. Returns false, with the reason as the notice, when refused. */
export function resizeDesign(core: EditorCore, size: ArtboardSize, scaleContent: boolean): boolean {
  const plan = planResize(core.doc, size, core.mode, scaleContent);
  return runPlan(core, plan.ok ? { ...plan, select: [...core.getState().selection] } : plan);
}

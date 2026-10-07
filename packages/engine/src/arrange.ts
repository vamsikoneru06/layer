import type { Doc, Lock, NodeId } from "@vash/schema";
import type { Command } from "./commands";
import { aabb, apply, boxCorners, IDENTITY, invert, type Box } from "./math";
import type { EditMode } from "./policy";
import { parentOf, worldMatrix } from "./scene";
import { checked, refuse, siblingsOf, subtreeOf, topLevelSelection, type Plan } from "./selection-utils";

export type ReorderTarget = "forward" | "front" | "backward" | "back";
export type AlignEdge = "left" | "center" | "right" | "top" | "middle" | "bottom";
export type Axis = "horizontal" | "vertical";

const SELECT_FIRST = "Select a layer first.";

/** Shifts smaller than this (artboard units) count as "already there", so rounding never makes a move. */
const EPSILON = 1e-3;

/** The list after moving the picked layers. Each picked layer passes its next unpicked neighbour; picked layers keep their order. */
function reordered(list: readonly NodeId[], picked: ReadonlySet<NodeId>, where: ReorderTarget): NodeId[] {
  const next = [...list];
  if (where === "front") return [...next.filter((id) => !picked.has(id)), ...next.filter((id) => picked.has(id))];
  if (where === "back") return [...next.filter((id) => picked.has(id)), ...next.filter((id) => !picked.has(id))];
  if (where === "forward") {
    for (let i = next.length - 2; i >= 0; i--) if (picked.has(next[i]!) && !picked.has(next[i + 1]!)) [next[i], next[i + 1]] = [next[i + 1]!, next[i]!];
  } else {
    for (let i = 1; i < next.length; i++) if (picked.has(next[i]!) && !picked.has(next[i - 1]!)) [next[i], next[i - 1]] = [next[i - 1]!, next[i]!];
  }
  return next;
}

/**
 * Moves the selected layers up or down their own sibling lists (several parents are handled
 * separately). Only selected layers get a `reorder`. Moving up, the topmost target goes first;
 * moving down, the bottom-most: each move then leaves the ones already placed where they belong.
 */
export function planReorder(doc: Doc, selection: readonly NodeId[], mode: EditMode, where: ReorderTarget): Plan {
  const roots = topLevelSelection(doc, selection);
  if (roots.length === 0) return refuse(SELECT_FIRST);
  const up = where === "forward" || where === "front";

  const byParent = new Map<NodeId | null, Set<NodeId>>();
  for (const id of roots) {
    const parent = parentOf(doc, id);
    byParent.set(parent, (byParent.get(parent) ?? new Set()).add(id));
  }
  const commands: Command[] = [];
  for (const [parent, picked] of byParent) {
    const list = siblingsOf(doc, parent);
    const target = reordered(list, picked, where);
    const moves = target.flatMap((id, index) => (picked.has(id) && list.indexOf(id) !== index ? [{ id, index }] : []));
    if (up) moves.reverse();
    commands.push(...moves.map((m): Command => ({ type: "reorder", ...m })));
  }
  if (commands.length === 0) return refuse(up ? "Already at the front." : "Already at the back.");
  return checked(doc, { type: "batch", commands }, mode, selection);
}

/** The layer's visible box: its width and height at its world transform, as an axis-aligned rectangle. */
function visibleBox(doc: Doc, id: NodeId): Box {
  const node = doc.nodes[id]!;
  return aabb(boxCorners(node.width, node.height, worldMatrix(doc, id)));
}

/** Moves a layer by (dx, dy) on the artboard. The shift is converted into its parent's space, so a layer inside a rotated or scaled group still lands where it should. */
function shiftBy(doc: Doc, id: NodeId, dx: number, dy: number): Command | null {
  const wx = Math.abs(dx) < EPSILON ? 0 : dx;
  const wy = Math.abs(dy) < EPSILON ? 0 : dy;
  if (wx === 0 && wy === 0) return null;
  const parent = parentOf(doc, id);
  const m = parent ? worldMatrix(doc, parent) : IDENTITY;
  const back = invert([m[0], m[1], m[2], m[3], 0, 0]);
  if (!back) return null;
  const local = apply(back, { x: wx, y: wy });
  const t = doc.nodes[id]!.transform;
  return { type: "update", id, patch: { transform: { ...t, x: t.x + local.x, y: t.y + local.y } } };
}

/** One layer aligns to the artboard; several align to the box around all of them. */
export function planAlign(doc: Doc, selection: readonly NodeId[], mode: EditMode, edge: AlignEdge): Plan {
  const roots = topLevelSelection(doc, selection);
  if (roots.length === 0) return refuse(SELECT_FIRST);
  const boxes = roots.map((id) => visibleBox(doc, id));
  const target: Box =
    roots.length === 1
      ? { minX: 0, minY: 0, maxX: doc.artboard.width, maxY: doc.artboard.height }
      : {
          minX: Math.min(...boxes.map((b) => b.minX)),
          minY: Math.min(...boxes.map((b) => b.minY)),
          maxX: Math.max(...boxes.map((b) => b.maxX)),
          maxY: Math.max(...boxes.map((b) => b.maxY)),
        };

  const commands = roots.flatMap((id, i): Command[] => {
    const b = boxes[i]!;
    const dx = edge === "left" ? target.minX - b.minX : edge === "right" ? target.maxX - b.maxX : edge === "center" ? (target.minX + target.maxX - b.minX - b.maxX) / 2 : 0;
    const dy = edge === "top" ? target.minY - b.minY : edge === "bottom" ? target.maxY - b.maxY : edge === "middle" ? (target.minY + target.maxY - b.minY - b.maxY) / 2 : 0;
    const move = shiftBy(doc, id, dx, dy);
    return move ? [move] : [];
  });
  if (commands.length === 0) return refuse("Already aligned.");
  return checked(doc, { type: "batch", commands }, mode, selection);
}

/**
 * Spreads three or more layers so the gaps between their visible boxes are equal. The layers with the
 * first and last box start stay where they are; the rest keep their order. Gaps are negative when the boxes overlap.
 */
export function planDistribute(doc: Doc, selection: readonly NodeId[], mode: EditMode, axis: Axis): Plan {
  const roots = topLevelSelection(doc, selection);
  if (roots.length < 3) return refuse("Select three or more layers to distribute.");
  const horizontal = axis === "horizontal";
  const items = roots
    .map((id) => {
      const b = visibleBox(doc, id);
      return { id, start: horizontal ? b.minX : b.minY, size: horizontal ? b.maxX - b.minX : b.maxY - b.minY };
    })
    .sort((a, b) => a.start - b.start); // stable: layers that start together keep their stacking order
  const first = items[0]!;
  const last = items.at(-1)!;
  const middle = items.slice(1, -1);
  const gap = (last.start - (first.start + first.size) - middle.reduce((sum, m) => sum + m.size, 0)) / (items.length - 1);

  const commands: Command[] = [];
  let cursor = first.start + first.size;
  for (const m of middle) {
    const start = cursor + gap;
    const move = shiftBy(doc, m.id, horizontal ? start - m.start : 0, horizontal ? 0 : start - m.start);
    if (move) commands.push(move);
    cursor = start + m.size;
  }
  if (commands.length === 0) return refuse("Already evenly spaced.");
  return checked(doc, { type: "batch", commands }, mode, selection);
}

/** Mirrors each selected layer about its own centre by negating its scale. Text would read backwards, so it is refused. */
export function planFlip(doc: Doc, selection: readonly NodeId[], mode: EditMode, axis: Axis): Plan {
  const roots = topLevelSelection(doc, selection);
  if (roots.length === 0) return refuse(SELECT_FIRST);
  if (roots.some((id) => subtreeOf((n) => doc.nodes[n], id).some((n) => n.type === "text"))) return refuse("Text can't be flipped.");
  const commands = roots.map((id): Command => {
    const t = doc.nodes[id]!.transform;
    return { type: "update", id, patch: { transform: axis === "horizontal" ? { ...t, scaleX: -t.scaleX } : { ...t, scaleY: -t.scaleY } } };
  });
  return checked(doc, { type: "batch", commands }, mode, selection);
}

/** "Unlock" when any selected layer is not free (the toggle will free them), otherwise "Lock". */
export function lockLabel(doc: Doc, selection: readonly NodeId[]): "Lock" | "Unlock" {
  return topLevelSelection(doc, selection).some((id) => doc.nodes[id]!.lock !== "free") ? "Unlock" : "Lock";
}

/**
 * Locks the selection when every layer is free; otherwise frees every layer that has any lock
 * (locked or content-only). Which changes are allowed is the lock policy's call.
 */
export function planToggleLock(doc: Doc, selection: readonly NodeId[], mode: EditMode): Plan {
  const roots = topLevelSelection(doc, selection);
  if (roots.length === 0) return refuse(SELECT_FIRST);
  const locking = lockLabel(doc, selection) === "Lock";
  const next: Lock = locking ? "locked" : "free";
  const commands = roots.filter((id) => locking || doc.nodes[id]!.lock !== "free").map((id): Command => ({ type: "update", id, patch: { lock: next } }));
  return checked(doc, { type: "batch", commands }, mode, selection);
}

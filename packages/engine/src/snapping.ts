import type { Doc, NodeId } from "@vash/schema";
import { worldBounds } from "./hit-test";
import type { Box } from "./math";
import { drawOrder } from "./scene";

export type Axis = "x" | "y";

/** A pink guide line at `at` on one axis, drawn from `from` to `to` along the other. */
export interface Guide {
  axis: Axis;
  at: number;
  from: number;
  to: number;
}

interface Target {
  at: number;
  /** Extent of the target along the other axis, so the guide can span it. */
  from: number;
  to: number;
}

export interface Snapper {
  /** How far to shift `box` so one of its edges or its centre lands on a target, per axis. */
  snapBox(box: Box, threshold: number): { dx: number; dy: number; guides: Guide[] };
  /** Snap one coordinate (a resize handle). */
  snapValue(axis: Axis, value: number, threshold: number): { value: number; guide: Guide | null };
}

/** Nearest target to `value` by binary search over targets sorted by position. */
function nearest(targets: Target[], value: number): Target | null {
  if (targets.length === 0) return null;
  let lo = 0;
  let hi = targets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (targets[mid]!.at < value) lo = mid + 1;
    else hi = mid;
  }
  const a = targets[lo]!;
  const b = targets[lo - 1];
  return b && Math.abs(b.at - value) <= Math.abs(a.at - value) ? b : a;
}

/**
 * Targets are the artboard's edges and centre plus every other visible layer's bounds, built once
 * when a drag starts. Thresholds are in artboard units (6 screen px ÷ zoom).
 */
export function createSnapper(doc: Doc, exclude: ReadonlySet<NodeId>): Snapper {
  const { width, height } = doc.artboard;
  const xs: Target[] = [0, width / 2, width].map((at) => ({ at, from: 0, to: height }));
  const ys: Target[] = [0, height / 2, height].map((at) => ({ at, from: 0, to: width }));
  for (const id of drawOrder(doc)) {
    if (exclude.has(id)) continue;
    const b = worldBounds(doc, id);
    if (!b) continue;
    for (const at of [b.minX, (b.minX + b.maxX) / 2, b.maxX]) xs.push({ at, from: b.minY, to: b.maxY });
    for (const at of [b.minY, (b.minY + b.maxY) / 2, b.maxY]) ys.push({ at, from: b.minX, to: b.maxX });
  }
  xs.sort((a, b) => a.at - b.at);
  ys.sort((a, b) => a.at - b.at);
  const targets = { x: xs, y: ys };

  function best(axis: Axis, anchors: number[], threshold: number): { delta: number; target: Target } | null {
    let found: { delta: number; target: Target } | null = null;
    for (const anchor of anchors) {
      const t = nearest(targets[axis], anchor);
      if (!t) continue;
      const delta = t.at - anchor;
      if (Math.abs(delta) <= threshold && (!found || Math.abs(delta) < Math.abs(found.delta))) found = { delta, target: t };
    }
    return found;
  }

  return {
    snapBox(box, threshold) {
      const x = best("x", [box.minX, (box.minX + box.maxX) / 2, box.maxX], threshold);
      const y = best("y", [box.minY, (box.minY + box.maxY) / 2, box.maxY], threshold);
      const dx = x?.delta ?? 0;
      const dy = y?.delta ?? 0;
      const guides: Guide[] = [];
      if (x) guides.push({ axis: "x", at: x.target.at, from: Math.min(x.target.from, box.minY + dy), to: Math.max(x.target.to, box.maxY + dy) });
      if (y) guides.push({ axis: "y", at: y.target.at, from: Math.min(y.target.from, box.minX + dx), to: Math.max(y.target.to, box.maxX + dx) });
      return { dx, dy, guides };
    },

    snapValue(axis, value, threshold) {
      const hit = best(axis, [value], threshold);
      if (!hit) return { value, guide: null };
      return { value: hit.target.at, guide: { axis, at: hit.target.at, from: hit.target.from, to: hit.target.to } };
    },
  };
}

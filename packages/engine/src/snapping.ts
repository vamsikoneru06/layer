import type { Doc, NodeId } from "@vash/schema";
import { worldBounds } from "./hit-test";
import type { Box } from "./math";
import { drawOrder, parentOf } from "./scene";

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

/** Which targets a drag snaps to. Guides are positions on the artboard, in design px. */
export interface SnapOptions {
  /** Artboard edges and centre, and other layers' edges and centres. */
  objects: boolean;
  guides: { x: number[]; y: number[] };
}

export const DEFAULT_SNAP: SnapOptions = { objects: true, guides: { x: [], y: [] } };

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
 * Targets are the artboard's edges and centre plus every other visible layer's bounds (when `objects`
 * is on), and the guides, built once when a drag starts. Thresholds are in artboard units (6 screen px ÷ zoom).
 */
/** True when the layer, or any group it sits in, is being dragged: a moving group must not snap to its own children. */
function isOrInside(doc: Doc, id: NodeId, exclude: ReadonlySet<NodeId>): boolean {
  for (let at: NodeId | null = id; at !== null; at = parentOf(doc, at)) if (exclude.has(at)) return true;
  return false;
}

export function createSnapper(doc: Doc, exclude: ReadonlySet<NodeId>, options: SnapOptions = DEFAULT_SNAP): Snapper {
  const { width, height } = doc.artboard;
  const xs: Target[] = options.objects ? [0, width / 2, width].map((at) => ({ at, from: 0, to: height })) : [];
  const ys: Target[] = options.objects ? [0, height / 2, height].map((at) => ({ at, from: 0, to: width })) : [];
  for (const at of options.guides.x) xs.push({ at, from: 0, to: height });
  for (const at of options.guides.y) ys.push({ at, from: 0, to: width });
  if (options.objects) {
    for (const id of drawOrder(doc)) {
      if (isOrInside(doc, id, exclude)) continue;
      const b = worldBounds(doc, id);
      if (!b) continue;
      for (const at of [b.minX, (b.minX + b.maxX) / 2, b.maxX]) xs.push({ at, from: b.minY, to: b.maxY });
      for (const at of [b.minY, (b.minY + b.maxY) / 2, b.maxY]) ys.push({ at, from: b.minX, to: b.maxX });
    }
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

/** A spacing marker: the segment `from` to `to` along `axis`, drawn at `at` on the other axis (design px). */
export interface SpacingIndicator {
  axis: Axis;
  from: number;
  to: number;
  at: number;
}

export interface SpacingSnap {
  dx: number;
  dy: number;
  indicators: SpacingIndicator[];
}

interface Span {
  lo: number;
  hi: number;
}

/** A positive gap between two other boxes that share a row (x) or column (y). */
interface Gap {
  size: number;
  from: number;
  to: number;
  at: number;
}

/** Tolerance for "already equal" once a box has been snapped, in design px. */
const EXACT = 1e-6;

const alongSpan = (b: Box, axis: Axis): Span => (axis === "x" ? { lo: b.minX, hi: b.maxX } : { lo: b.minY, hi: b.maxY });
const acrossSpan = (b: Box, axis: Axis): Span => (axis === "x" ? { lo: b.minY, hi: b.maxY } : { lo: b.minX, hi: b.maxX });

/** The shared part of two spans, or null when they only touch or do not meet. */
function overlap(a: Span, b: Span): Span | null {
  const lo = Math.max(a.lo, b.lo);
  const hi = Math.min(a.hi, b.hi);
  return lo < hi ? { lo, hi } : null;
}

/** Every gap between two other boxes in the same row (x) or column (y), smallest first. */
function gapsAlong(axis: Axis, others: Box[]): Gap[] {
  const gaps: Gap[] = [];
  for (const a of others) {
    const sa = alongSpan(a, axis);
    for (const b of others) {
      const sb = alongSpan(b, axis);
      const shared = overlap(acrossSpan(a, axis), acrossSpan(b, axis));
      if (!shared || sb.lo <= sa.hi) continue;
      gaps.push({ size: sb.lo - sa.hi, from: sa.hi, to: sb.lo, at: (shared.lo + shared.hi) / 2 });
    }
  }
  return gaps.sort((p, q) => p.size - q.size);
}

/** The gap whose size is nearest to `size` (binary search over the sorted gaps). */
function nearestGap(gaps: Gap[], size: number): Gap | null {
  if (gaps.length === 0) return null;
  let lo = 0;
  let hi = gaps.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (gaps[mid]!.size < size) lo = mid + 1;
    else hi = mid;
  }
  const a = gaps[lo]!;
  const b = gaps[lo - 1];
  return b && Math.abs(b.size - size) <= Math.abs(a.size - size) ? b : a;
}

interface Match {
  shift: number;
  indicators: SpacingIndicator[];
}

/**
 * The smallest shift along `axis` (within `threshold`) that makes the box's gap to one neighbour equal an existing
 * gap. Only neighbours that share the box's row (x) or column (y) count.
 */
function matchAxis(axis: Axis, box: Box, others: Box[], gaps: Gap[], threshold: number): Match | null {
  const m = alongSpan(box, axis);
  const across = acrossSpan(box, axis);
  let best: { shift: number; moving: { from: number; to: number; at: number }; ref: Gap } | null = null;
  for (const o of others) {
    const shared = overlap(across, acrossSpan(o, axis));
    const os = alongSpan(o, axis);
    const after = os.lo >= m.hi;
    const before = os.hi <= m.lo;
    if (!shared || (!after && !before)) continue;
    const gap = after ? os.lo - m.hi : m.lo - os.hi;
    const ref = nearestGap(gaps, gap);
    if (!ref) continue;
    // Moving the box by `shift` makes its gap to `o` equal `ref.size`.
    const shift = after ? gap - ref.size : ref.size - gap;
    if (Math.abs(shift) > threshold || (best && Math.abs(shift) >= Math.abs(best.shift))) continue;
    const at = (shared.lo + shared.hi) / 2;
    const moving = after ? { from: m.hi + shift, to: os.lo, at } : { from: os.hi, to: m.lo + shift, at };
    best = { shift, moving, ref };
  }
  if (!best) return null;
  return {
    shift: best.shift,
    indicators: [
      { axis, ...best.moving },
      { axis, from: best.ref.from, to: best.ref.to, at: best.ref.at },
    ],
  };
}

/**
 * Equal-spacing snap for one moving box, used only while dragging a single selection. Per axis, the box is shifted
 * by the smallest amount (within `threshold`) that makes its gap to a neighbour in the same row or column equal an
 * existing gap between two other boxes. Indicators mark the moving gap and the matched gap at the snapped position.
 * Cost: building the gaps is O(n^2 log n) and each query is O(n log n), with n the number of other boxes, which is
 * small for a design.
 */
export function spacingSnap(box: Box, others: Box[], threshold: number): SpacingSnap {
  const gaps = { x: gapsAlong("x", others), y: gapsAlong("y", others) };
  const x = matchAxis("x", box, others, gaps.x, threshold);
  const y = matchAxis("y", box, others, gaps.y, threshold);
  if (!x && !y) return { dx: 0, dy: 0, indicators: [] };
  const dx = x?.shift ?? 0;
  const dy = y?.shift ?? 0;
  // Indicators are drawn where the box lands, so match again there (each axis is now an exact match).
  const moved = { minX: box.minX + dx, maxX: box.maxX + dx, minY: box.minY + dy, maxY: box.maxY + dy };
  const indicators = [
    ...(matchAxis("x", moved, others, gaps.x, EXACT)?.indicators ?? []),
    ...(matchAxis("y", moved, others, gaps.y, EXACT)?.indicators ?? []),
  ];
  return { dx, dy, indicators };
}

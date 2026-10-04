import type { Doc, NodeId } from "@vash/schema";
import { worldBounds } from "./hit-test";
import { apply, translation, type Mat, type Point } from "./math";
import { worldMatrix } from "./scene";
import { toScreen, type Viewport } from "./viewport";

/** The box drawn around the selection: centred on the local origin of `matrix`, `width` × `height`. */
export interface SelectionFrame {
  matrix: Mat;
  width: number;
  height: number;
  /** Degrees; 0 for a multi-selection. */
  rotation: number;
}

export type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
export type Handle = ResizeHandle | "rotate";

/** Unit direction of each resize handle from the box centre (−1, 0 or 1 on each axis). */
export const HANDLE_DIRECTIONS: Record<ResizeHandle, { x: number; y: number }> = {
  nw: { x: -1, y: -1 },
  n: { x: 0, y: -1 },
  ne: { x: 1, y: -1 },
  e: { x: 1, y: 0 },
  se: { x: 1, y: 1 },
  s: { x: 0, y: 1 },
  sw: { x: -1, y: 1 },
  w: { x: -1, y: 0 },
};

/** Screen px: handle hit radius, and the rotate handle's distance above the top edge. */
export const HANDLE_HIT_RADIUS = 7;
export const ROTATE_OFFSET = 24;

export function selectionFrame(doc: Doc, ids: readonly NodeId[]): SelectionFrame | null {
  const nodes = ids.map((id) => doc.nodes[id]).filter((n) => n !== undefined);
  if (nodes.length === 0) return null;
  if (nodes.length === 1) {
    const n = nodes[0]!;
    const m = worldMatrix(doc, n.id);
    // Rotation of the node on screen, recovered from its world matrix (includes group rotation).
    const rotation = (Math.atan2(m[1], m[0]) * 180) / Math.PI;
    // The matrix carries scale, so the frame is the node's own unscaled box.
    return { matrix: m, width: n.width, height: n.height, rotation: Math.round(rotation * 1e6) / 1e6 };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    const b = worldBounds(doc, n.id)!;
    minX = Math.min(minX, b.minX);
    minY = Math.min(minY, b.minY);
    maxX = Math.max(maxX, b.maxX);
    maxY = Math.max(maxY, b.maxY);
  }
  return { matrix: translation((minX + maxX) / 2, (minY + maxY) / 2), width: maxX - minX, height: maxY - minY, rotation: 0 };
}

/** Screen positions of every handle. */
export function handlePositions(f: SelectionFrame, v: Viewport): Record<Handle, Point> {
  const at = (x: number, y: number) => toScreen(v, apply(f.matrix, { x, y }));
  const out = {} as Record<Handle, Point>;
  for (const [h, d] of Object.entries(HANDLE_DIRECTIONS) as [ResizeHandle, { x: number; y: number }][]) {
    out[h] = at((d.x * f.width) / 2, (d.y * f.height) / 2);
  }
  // Rotate handle: ROTATE_OFFSET screen px beyond the top edge's midpoint, along the box's "up".
  const top = out.n;
  const centre = at(0, 0);
  const len = Math.hypot(top.x - centre.x, top.y - centre.y) || 1;
  out.rotate = { x: top.x + ((top.x - centre.x) / len) * ROTATE_OFFSET, y: top.y + ((top.y - centre.y) / len) * ROTATE_OFFSET };
  return out;
}

const ORDER: Handle[] = ["rotate", "nw", "ne", "se", "sw", "n", "e", "s", "w"];

/** The handle within reach of `screen`, if any. Layout-locked selections expose no handles. */
export function handleAt(f: SelectionFrame, v: Viewport, screen: Point, o: { layoutLocked?: boolean } = {}): Handle | null {
  if (o.layoutLocked) return null;
  const positions = handlePositions(f, v);
  for (const h of ORDER) {
    const p = positions[h];
    if (Math.hypot(p.x - screen.x, p.y - screen.y) <= HANDLE_HIT_RADIUS) return h;
  }
  return null;
}

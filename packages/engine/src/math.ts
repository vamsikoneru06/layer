import type { Transform } from "@vash/schema";

export interface Point {
  x: number;
  y: number;
}

/** Affine 2×3 matrix [a, b, c, d, e, f]: x' = a·x + c·y + e, y' = b·x + d·y + f (Canvas2D order). */
export type Mat = readonly [number, number, number, number, number, number];

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

export const translation = (x: number, y: number): Mat => [1, 0, 0, 1, x, y];

/** Degrees, clockwise on screen (y points down). */
export function rotation(degrees: number): Mat {
  if (degrees === 0) return IDENTITY;
  const r = (degrees * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return [cos, sin, -sin, cos, 0, 0];
}

export const scaling = (sx: number, sy: number): Mat => [sx, 0, 0, sy, 0, 0];

/** `multiply(m, n)` applies `n` first, then `m`. */
export function multiply(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function invert(m: Mat): Mat | null {
  const det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) < 1e-12) return null;
  return [
    m[3] / det,
    -m[1] / det,
    -m[2] / det,
    m[0] / det,
    (m[2] * m[5] - m[3] * m[4]) / det,
    (m[1] * m[4] - m[0] * m[5]) / det,
  ];
}

export function apply(m: Mat, p: Point): Point {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

/** Local → parent for a node: T(x, y) · R(rotation) · S(scaleX, scaleY), about the node centre. */
export function fromTransform(t: Transform): Mat {
  return multiply(multiply(translation(t.x, t.y), rotation(t.rotation)), scaling(t.scaleX, t.scaleY));
}

/** Corners (clockwise from top-left) of a box centred on the local origin, mapped by `m`. */
export function boxCorners(width: number, height: number, m: Mat): [Point, Point, Point, Point] {
  const w = width / 2;
  const h = height / 2;
  return [apply(m, { x: -w, y: -h }), apply(m, { x: w, y: -h }), apply(m, { x: w, y: h }), apply(m, { x: -w, y: h })];
}

export function aabb(points: readonly Point[]): Box {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

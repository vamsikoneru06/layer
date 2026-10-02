import type { Point } from "./math";

/**
 * Point-in-outline tests for hit testing, in a node's own centred coordinates. They match what render.ts
 * draws: polygons start at the top, SVG paths live in a unit box scaled to the node, fills use nonzero.
 */

type Ring = Point[];

const CURVE_STEPS = 16;

/** Vertices of a regular polygon inscribed in the w×h box, first vertex at the top (as render.ts traces it). */
export function polygonRing(sides: number, w: number, h: number): Ring {
  const ring: Ring = [];
  for (let i = 0; i < sides; i++) {
    const t = -Math.PI / 2 + (i * 2 * Math.PI) / sides;
    ring.push({ x: (w / 2) * Math.cos(t), y: (h / 2) * Math.sin(t) });
  }
  return ring;
}

const NUMBER = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;
const ARGS: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

/**
 * Flattens SVG path data (already checked by @vash/schema's validatePathData) into closed rings in its own
 * coordinates. Curves and arcs become short line segments: plenty for picking a layer under the pointer.
 */
export function flattenPath(d: string): Ring[] {
  const rings: Ring[] = [];
  let ring: Ring = [];
  let cur = { x: 0, y: 0 };
  let start = { x: 0, y: 0 };
  let ctrl: Point | null = null; // last cubic (C/S) or quadratic (Q/T) control point, for reflection
  let lastCmd = "";
  const close = () => {
    if (ring.length > 2) rings.push(ring);
    ring = [];
  };
  const lineTo = (p: Point) => {
    if (ring.length === 0) ring.push(cur);
    ring.push(p);
    cur = p;
  };

  let i = 0;
  let cmd = "";
  while (i < d.length) {
    const ch = d[i]!;
    if (/[\s,]/.test(ch)) {
      i++;
      continue;
    }
    if (ch.toUpperCase() in ARGS) {
      cmd = ch;
      i++;
      if (cmd.toUpperCase() !== "Z") continue;
    }
    const upper = cmd.toUpperCase();
    const rel = cmd !== upper;
    const args: number[] = [];
    for (let k = 0; k < ARGS[upper]!; k++) {
      while (i < d.length && /[\s,]/.test(d[i]!)) i++;
      NUMBER.lastIndex = i;
      const m = NUMBER.exec(d);
      if (!m) return rings; // validated input never gets here
      args.push(Number(m[0]));
      i = NUMBER.lastIndex;
    }
    const at = (x: number, y: number): Point => (rel ? { x: cur.x + x, y: cur.y + y } : { x, y });
    const isCubic = lastCmd === "C" || lastCmd === "S";
    const isQuad = lastCmd === "Q" || lastCmd === "T";
    let nextCtrl: Point | null = null;
    switch (upper) {
      case "M":
        close();
        cur = at(args[0]!, args[1]!);
        start = cur;
        cmd = rel ? "l" : "L"; // extra pairs after a moveto are linetos
        break;
      case "L":
        lineTo(at(args[0]!, args[1]!));
        break;
      case "H":
        lineTo({ x: rel ? cur.x + args[0]! : args[0]!, y: cur.y });
        break;
      case "V":
        lineTo({ x: cur.x, y: rel ? cur.y + args[0]! : args[0]! });
        break;
      case "C":
      case "S": {
        const c1: Point = upper === "C" ? at(args[0]!, args[1]!) : isCubic && ctrl ? reflect(ctrl, cur) : cur;
        const c2 = upper === "C" ? at(args[2]!, args[3]!) : at(args[0]!, args[1]!);
        const end = upper === "C" ? at(args[4]!, args[5]!) : at(args[2]!, args[3]!);
        const p0 = cur;
        for (let s = 1; s <= CURVE_STEPS; s++) lineTo(cubic(p0, c1, c2, end, s / CURVE_STEPS));
        nextCtrl = c2;
        break;
      }
      case "Q":
      case "T": {
        const c: Point = upper === "Q" ? at(args[0]!, args[1]!) : isQuad && ctrl ? reflect(ctrl, cur) : cur;
        const end = upper === "Q" ? at(args[2]!, args[3]!) : at(args[0]!, args[1]!);
        const p0 = cur;
        for (let s = 1; s <= CURVE_STEPS; s++) lineTo(quad(p0, c, end, s / CURVE_STEPS));
        nextCtrl = c;
        break;
      }
      case "A": {
        const end = at(args[5]!, args[6]!);
        for (const p of arc(cur, args[0]!, args[1]!, args[2]!, args[3]!, args[4]!, end)) lineTo(p);
        break;
      }
      case "Z":
        cur = start;
        close();
        break;
    }
    ctrl = nextCtrl;
    lastCmd = upper === "M" ? "L" : upper;
  }
  close();
  return rings;
}

const reflect = (c: Point, about: Point): Point => ({ x: 2 * about.x - c.x, y: 2 * about.y - c.y });

function cubic(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, e = t * t * t;
  return { x: a * p0.x + b * p1.x + c * p2.x + e * p3.x, y: a * p0.y + b * p1.y + c * p2.y + e * p3.y };
}

function quad(p0: Point, p1: Point, p2: Point, t: number): Point {
  const u = 1 - t;
  return { x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x, y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y };
}

/** SVG elliptical arc, endpoint to centre parameterisation (SVG 1.1 appendix F.6.5), sampled. */
function arc(p0: Point, rxIn: number, ryIn: number, angleDeg: number, large: number, sweep: number, p1: Point): Point[] {
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0 || (p0.x === p1.x && p0.y === p1.y)) return [p1];
  const phi = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(phi), sin = Math.sin(phi);
  const dx = (p0.x - p1.x) / 2, dy = (p0.y - p1.y) / 2;
  const x1 = cos * dx + sin * dy, y1 = -sin * dx + cos * dy;
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  const k = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cx1 = (k * rx * y1) / ry, cy1 = (-k * ry * x1) / rx;
  const cx = cos * cx1 - sin * cy1 + (p0.x + p1.x) / 2;
  const cy = sin * cx1 + cos * cy1 + (p0.y + p1.y) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t1 = angle(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let dt = angle((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  if (sweep && dt < 0) dt += 2 * Math.PI;
  const points: Point[] = [];
  for (let s = 1; s <= CURVE_STEPS; s++) {
    const t = t1 + (dt * s) / CURVE_STEPS;
    const ex = rx * Math.cos(t), ey = ry * Math.sin(t);
    points.push(s === CURVE_STEPS ? p1 : { x: cos * ex - sin * ey + cx, y: sin * ex + cos * ey + cy });
  }
  return points;
}

/** Nonzero winding over every ring, matching canvas fill() (its default rule). */
export function insideRings(rings: readonly Ring[], p: Point): boolean {
  let winding = 0;
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!;
      const b = ring[(i + 1) % ring.length]!;
      const cross = (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y);
      if (a.y <= p.y) {
        if (b.y > p.y && cross > 0) winding++;
      } else if (b.y <= p.y && cross < 0) winding--;
    }
  }
  return winding !== 0;
}

/** Is p within `pad` of any edge? Lets a small tolerance still pick thin or pointed shapes. */
export function nearRings(rings: readonly Ring[], p: Point, pad: number): boolean {
  if (pad <= 0) return false;
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      if (distanceToSegment(p, ring[i]!, ring[(i + 1) % ring.length]!) <= pad) return true;
    }
  }
  return false;
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const vx = b.x - a.x, vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2));
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}

const unitPaths = new Map<string, Ring[]>();

/** A unit-box path flattened once, then scaled to w×h and centred, as render.ts draws it. */
export function pathRings(d: string, w: number, h: number): Ring[] {
  let unit = unitPaths.get(d);
  if (!unit) {
    unit = flattenPath(d);
    if (unitPaths.size > 500) unitPaths.clear();
    unitPaths.set(d, unit);
  }
  return unit.map((ring) => ring.map((q) => ({ x: q.x * w - w / 2, y: q.y * h - h / 2 })));
}

/** Rounded rectangle centred on the origin; the radius is clamped as render.ts clamps it. */
export function insideRoundRect(p: Point, w: number, h: number, radius: number, pad: number): boolean {
  const hw = w / 2, hh = h / 2;
  const r = Math.min(radius, hw, hh);
  const qx = Math.abs(p.x) - (hw - r);
  const qy = Math.abs(p.y) - (hh - r);
  if (qx > r + pad || qy > r + pad) return false;
  if (qx <= 0 || qy <= 0) return true;
  return Math.hypot(qx, qy) <= r + pad;
}

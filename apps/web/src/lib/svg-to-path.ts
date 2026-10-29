/**
 * Converts SVG basic shapes and path data into the path grammar that `validatePathData` accepts, scaled by a
 * factor (the icon build uses 1/24 to map lucide's 24 by 24 grid onto the 0 to 1 unit box).
 * Used by apps/web/scripts/build-icons.ts.
 */

export type IconAttrs = Record<string, string | undefined>;
export type IconNode = readonly (readonly [tag: string, attrs: IconAttrs])[];

const ARG_COUNTS: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };
const NUMBER = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;

/** Rounds to 4 decimals and avoids "-0". */
function format(n: number): string {
  const r = Math.round(n * 1e4) / 1e4;
  return String(Object.is(r, -0) ? 0 : r);
}

/**
 * Scales every length in a path by `factor`. Relative and absolute commands both scale linearly. Arc rotation
 * and the two arc flags are not lengths, so they are kept as they are.
 */
export function scalePathData(d: string, factor: number): string {
  const out: string[] = [];
  let command = "";
  let index = 0;
  let i = 0;
  while (i < d.length) {
    const ch = d[i]!;
    if (ch === " " || ch === "," || ch === "\n" || ch === "\t" || ch === "\r") {
      i++;
      continue;
    }
    if (/[a-zA-Z]/.test(ch)) {
      const upper = ch.toUpperCase();
      if (!(upper in ARG_COUNTS)) throw new Error(`unsupported path command '${ch}'`);
      command = upper;
      index = 0;
      out.push(ch);
      i++;
      continue;
    }
    if (command === "") throw new Error("path data starts with a number, not a command");
    const argCount = ARG_COUNTS[command]!;
    if (argCount === 0) throw new Error(`numbers after '${command}' are not allowed`);
    const position = index % argCount;
    const isArcFlagOrAngle = command === "A" && position >= 2 && position <= 4;
    if (command === "A" && (position === 3 || position === 4)) {
      if (ch !== "0" && ch !== "1") throw new Error(`arc flag must be 0 or 1 at ${i}`);
      out.push(ch);
      i++;
    } else {
      NUMBER.lastIndex = i;
      const match = NUMBER.exec(d);
      if (!match) throw new Error(`unexpected character '${ch}' at ${i}`);
      const value = Number(match[0]);
      out.push(format(isArcFlagOrAngle ? value : value * factor));
      i += match[0].length;
    }
    index++;
  }
  return out.join(" ");
}

function num(value: string | undefined, name: string): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) throw new Error(`attribute ${name} is not a number: ${value}`);
  return n;
}

/** Rounds away floating point noise such as 2.0000000000000004 before it reaches the path string. */
const clean = (n: number): string => String(Math.round(n * 1e6) / 1e6);

function ellipsePath(cx: number, cy: number, rx: number, ry: number): string {
  // Two half arcs make a full ellipse, and both ends meet at the left-hand point.
  return `M ${clean(cx - rx)} ${clean(cy)} A ${clean(rx)} ${clean(ry)} 0 1 0 ${clean(cx + rx)} ${clean(cy)} A ${clean(rx)} ${clean(ry)} 0 1 0 ${clean(cx - rx)} ${clean(cy)} Z`;
}

function polyPath(points: string | undefined, close: boolean): string {
  const nums = (points ?? "").trim().split(/[\s,]+/).filter(Boolean).map(Number);
  if (nums.length < 4 || nums.length % 2 !== 0 || nums.some((n) => !Number.isFinite(n))) {
    throw new Error(`invalid points list: ${points}`);
  }
  const parts: string[] = [];
  for (let k = 0; k < nums.length; k += 2) parts.push(`${k === 0 ? "M" : "L"} ${clean(nums[k]!)} ${clean(nums[k + 1]!)}`);
  return close ? `${parts.join(" ")} Z` : parts.join(" ");
}

function rectPath(x: number, y: number, w: number, h: number, rxAttr: string | undefined, ryAttr: string | undefined): string {
  // SVG rule: a missing rx or ry takes the other value, and radii are clamped to half the box.
  const rxRaw = rxAttr ?? ryAttr;
  const ryRaw = ryAttr ?? rxAttr;
  const rx = Math.min(rxRaw === undefined ? 0 : num(rxRaw, "rx"), w / 2);
  const ry = Math.min(ryRaw === undefined ? 0 : num(ryRaw, "ry"), h / 2);
  const c = clean;
  if (rx <= 0 || ry <= 0) return `M ${c(x)} ${c(y)} H ${c(x + w)} V ${c(y + h)} H ${c(x)} Z`;
  return [
    `M ${c(x + rx)} ${c(y)}`,
    `H ${c(x + w - rx)}`,
    `A ${c(rx)} ${c(ry)} 0 0 1 ${c(x + w)} ${c(y + ry)}`,
    `V ${c(y + h - ry)}`,
    `A ${c(rx)} ${c(ry)} 0 0 1 ${c(x + w - rx)} ${c(y + h)}`,
    `H ${c(x + rx)}`,
    `A ${c(rx)} ${c(ry)} 0 0 1 ${c(x)} ${c(y + h - ry)}`,
    `V ${c(y + ry)}`,
    `A ${c(rx)} ${c(ry)} 0 0 1 ${c(x + rx)} ${c(y)}`,
    "Z",
  ].join(" ");
}

/** One SVG element as absolute path data in the element's own coordinates (no scaling). */
export function elementToPath(tag: string, attrs: IconAttrs): string {
  switch (tag) {
    case "path":
      if (!attrs.d) throw new Error("<path> without d");
      return attrs.d;
    case "circle": {
      const r = num(attrs.r, "r");
      return ellipsePath(num(attrs.cx, "cx"), num(attrs.cy, "cy"), r, r);
    }
    case "ellipse":
      return ellipsePath(num(attrs.cx, "cx"), num(attrs.cy, "cy"), num(attrs.rx, "rx"), num(attrs.ry, "ry"));
    case "line":
      return `M ${clean(num(attrs.x1, "x1"))} ${clean(num(attrs.y1, "y1"))} L ${clean(num(attrs.x2, "x2"))} ${clean(num(attrs.y2, "y2"))}`;
    case "polyline":
      return polyPath(attrs.points, false);
    case "polygon":
      return polyPath(attrs.points, true);
    case "rect":
      return rectPath(num(attrs.x, "x"), num(attrs.y, "y"), num(attrs.width, "width"), num(attrs.height, "height"), attrs.rx, attrs.ry);
    default:
      throw new Error(`unsupported SVG element <${tag}>`);
  }
}

/** A whole lucide icon node as one path string in the unit box (divides by `grid`, lucide uses 24). */
export function iconNodeToPathData(node: IconNode, grid = 24): string {
  return node
    .map(([tag, attrs]) => scalePathData(elementToPath(tag, attrs), 1 / grid))
    .join(" ");
}

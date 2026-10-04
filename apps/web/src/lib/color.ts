import type { Doc, Fill } from "@vash/schema";

/** A colour as the picker edits it: hue 0–360, saturation, value and alpha 0–1. */
export type Hsv = { h: number; s: number; v: number; a: number };

const HEX = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i;

/** `#RRGGBB` or `#RRGGBBAA` (the `#` optional) as channels 0–255 and alpha 0–1; null if malformed. */
export function parseHex(text: string): { r: number; g: number; b: number; a: number } | null {
  const m = HEX.exec(text.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: m[2] ? parseInt(m[2], 16) / 255 : 1 };
}

/** HSV for a hex code. Greys and black have no hue of their own, so they keep `hue` (the picker's current one). */
export function toHsv(hex: string, hue = 0): Hsv | null {
  const c = parseHex(hex);
  if (!c) return null;
  const r = c.r / 255, g = c.g / 255, b = c.b / 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = hue;
  if (d > 0) {
    h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max, a: c.a };
}

const byte = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 255).toString(16).padStart(2, "0").toUpperCase();

/** The hex code the document stores: alpha is written only when the colour isn't fully opaque. */
export function hsvToHex({ h, s, v, a }: Hsv): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return `#${byte(f(5))}${byte(f(3))}${byte(f(1))}${a < 1 ? byte(a) : ""}`;
}

/** CSS for a fill, matching how the canvas draws it (0° points up, 90° right). */
export function fillCss(fill: Fill): string {
  if (fill.type === "solid") return fill.color;
  const stops = fill.stops.map((s) => `${s.color} ${Math.round(s.offset * 100)}%`).join(", ");
  return `linear-gradient(${fill.angle}deg, ${stops})`;
}

/** Every colour the design uses, once each and in the order they appear, for quick reuse. */
export function docColors(doc: Doc): string[] {
  const seen = new Set<string>();
  const add = (c: string | undefined) => c && seen.add(c.toUpperCase());
  const addFill = (f: Fill | null | undefined) => {
    if (!f) return;
    if (f.type === "solid") add(f.color);
    else f.stops.forEach((s) => add(s.color));
  };
  addFill(doc.artboard.background);
  for (const node of Object.values(doc.nodes)) {
    if (node.type === "text") add(node.color);
    if (node.type === "shape") {
      addFill(node.fill);
      add(node.stroke?.color);
    }
  }
  return [...seen];
}

type Linear = Extract<Fill, { type: "linear" }>;

/** Switches a fill between solid and linear, keeping its main colour. */
export function convertFill(fill: Fill, type: Fill["type"]): Fill {
  if (fill.type === type) return fill;
  if (type === "solid") return { type: "solid", color: fill.type === "linear" ? fill.stops[0]!.color : "#000000" };
  const from = fill.type === "solid" ? fill.color : "#000000";
  const to = from.slice(0, 7).toUpperCase() === "#FFFFFF" ? "#1D1D1F" : "#FFFFFF";
  return { type: "linear", angle: 90, stops: [{ offset: 0, color: from }, { offset: 1, color: to }] };
}

/** Stops in offset order, which is how both the canvas and CSS lay them out. */
export const sortStops = (stops: Linear["stops"]) => [...stops].sort((a, b) => a.offset - b.offset);

/** A new stop in the middle of the widest gap, in the colour on its left. */
export function addStop(stops: Linear["stops"]): Linear["stops"] {
  const sorted = sortStops(stops);
  let at = 0;
  for (let i = 1; i < sorted.length - 1; i++) if (sorted[i + 1]!.offset - sorted[i]!.offset > sorted[at + 1]!.offset - sorted[at]!.offset) at = i;
  const offset = Math.round(((sorted[at]!.offset + sorted[at + 1]!.offset) / 2) * 100) / 100;
  return sortStops([...sorted, { offset, color: sorted[at]!.color }]);
}

import type { Doc, Fill, Node as DocNode } from "@vash/schema";

/** Recent colours live in this browser only. */
export const RECENT_KEY = "vash:recent-colors";
const RECENT_MAX = 8;

const HEX = /^#([0-9A-F]{6})([0-9A-F]{2})?$/i;

/**
 * `#RRGGBB` or `#RRGGBBAA` in uppercase, so one colour always has one spelling. A fully opaque
 * `FF` alpha is dropped, as the picker does. Anything else is null.
 */
export function normaliseColor(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const m = HEX.exec(input.trim());
  if (!m) return null;
  const alpha = m[2]?.toUpperCase();
  return `#${m[1]!.toUpperCase()}${alpha && alpha !== "FF" ? alpha : ""}`;
}

/**
 * Every colour the design uses (artboard, fills, gradient stops, strokes, text, outlines,
 * highlights, shadows, duotone), most used first. Ties keep the order they first appear in.
 */
export function designColors(doc: Doc, max = 16): string[] {
  // Map keeps insertion order, so the first time a colour is seen is its position for ties.
  const counts = new Map<string, number>();
  const use = (color: unknown) => {
    const c = normaliseColor(color);
    if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
  };
  const useFill = (fill: Fill | null | undefined) => {
    if (!fill) return;
    if (fill.type === "solid") use(fill.color);
    else if (fill.type === "linear") for (const stop of fill.stops) use(stop.color);
  };

  useFill(doc.artboard.background);
  for (const node of Object.values(doc.nodes)) {
    use(node.shadow?.color);
    useNode(node, use, useFill);
  }

  // Array.prototype.sort is stable, so equal counts keep first-appearance order.
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, Math.max(0, max))
    .map(([color]) => color);
}

function useNode(node: DocNode, use: (color: unknown) => void, useFill: (fill: Fill | null | undefined) => void) {
  switch (node.type) {
    case "text":
      use(node.color);
      use(node.outline?.color);
      use(node.highlight?.color);
      break;
    case "shape":
      useFill(node.fill);
      use(node.stroke?.color);
      break;
    case "frame":
      use(node.filters.duotone?.light);
      use(node.filters.duotone?.dark);
      break;
  }
}

/** The last colours picked in this browser, newest first. Never throws: a bad or missing store reads as empty. */
export function loadRecent(): string[] {
  try {
    const raw = globalThis.localStorage?.getItem(RECENT_KEY);
    if (raw == null) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? uniqueColors(parsed) : [];
  } catch {
    return [];
  }
}

/** Puts `color` at the front of the recent list and returns the new list. A colour that doesn't parse changes nothing. */
export function pushRecent(color: string): string[] {
  const c = normaliseColor(color);
  if (!c) return loadRecent();
  const next = uniqueColors([c, ...loadRecent()]);
  try {
    globalThis.localStorage?.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Storage is full or blocked, so this pick is not remembered. The list is still returned.
  }
  return next;
}

function uniqueColors(values: unknown[]): string[] {
  const out: string[] = [];
  for (const value of values) {
    const c = normaliseColor(value);
    if (c && !out.includes(c)) out.push(c);
    if (out.length === RECENT_MAX) break;
  }
  return out;
}

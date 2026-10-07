import type { FontSpec, TextNode } from "@vash/schema";

/** Width in px of `text` set in `font` at `size`, without letter spacing. The browser passes canvas measureText. */
export type Measure = (text: string, font: FontSpec, size: number) => number;

export interface TextLine {
  text: string;
  /** Offset of the line's top-left from the box's top-left. */
  x: number;
  y: number;
  width: number;
  /** Extra px between words on justified lines. */
  wordSpacing: number;
}

export interface TextLayout {
  size: number;
  lineHeight: number;
  lines: TextLine[];
  height: number;
  /** The text doesn't fit the box (always false after a successful shrink-to-fit). */
  overflow: boolean;
}

interface RawLine {
  text: string;
  width: number;
  last: boolean;
  broken: boolean;
}

const segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;
const PLAIN = /^[\x20-\x7e]*$/;

/**
 * Visible characters (grapheme clusters): an emoji with a skin tone, or a Telugu or Devanagari conjunct, is one
 * character however many code units it takes. Lines only break between them, and letter spacing applies once per character.
 */
export function graphemes(s: string): string[] {
  if (PLAIN.test(s)) return s.split("");
  return segmenter ? Array.from(segmenter.segment(s), (g) => g.segment) : Array.from(s);
}

export const graphemeCount = (s: string): number => (PLAIN.test(s) ? s.length : graphemes(s).length);

function wrap(node: TextNode, size: number, measure: Measure): RawLine[] {
  const width = (s: string) => measure(s, node.font, size) + (node.letterSpacing === 0 ? 0 : node.letterSpacing * graphemeCount(s));
  const lines: RawLine[] = [];
  for (const paragraph of node.content.split("\n")) {
    const words = paragraph.split(" ").filter((w, i, all) => w !== "" || all.length === 1);
    let current = "";
    const push = (text: string, last: boolean, broken = false) => lines.push({ text, width: width(text), last, broken });
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (width(candidate) <= node.width) {
        current = candidate;
        continue;
      }
      if (current) push(current, false);
      if (width(word) <= node.width) {
        current = word;
        continue;
      }
      // The word alone is wider than the box: break it between characters, at least one per line. The longest
      // prefix that fits is found by binary search (width only grows as characters are added).
      let rest = graphemes(word);
      while (rest.length > 1 && width(rest.join("")) > node.width) {
        let lo = 1;
        let hi = rest.length - 1;
        while (lo < hi) {
          const mid = (lo + hi + 1) >> 1;
          if (width(rest.slice(0, mid).join("")) <= node.width) lo = mid;
          else hi = mid - 1;
        }
        push(rest.slice(0, lo).join(""), false, true);
        rest = rest.slice(lo);
      }
      current = rest.join("");
    }
    push(current, true);
  }
  return lines;
}

function place(node: TextNode, size: number, raw: RawLine[]): TextLayout {
  const lineHeight = size * node.lineHeight;
  const height = raw.length * lineHeight;
  const top = (node.height - height) / 2;
  const lines = raw.map((l, i): TextLine => {
    const gaps = l.text.split(" ").length - 1;
    const justify = node.align === "justify" && !l.last && gaps > 0;
    const free = node.width - l.width;
    const x = node.align === "center" ? free / 2 : node.align === "right" ? free : 0;
    return { text: l.text, x: justify ? 0 : x, y: top + i * lineHeight, width: l.width, wordSpacing: justify ? free / gaps : 0 };
  });
  const overflow = height > node.height + 0.01 || raw.some((l) => l.broken);
  return { size, lineHeight, lines, height, overflow };
}

const layout = (node: TextNode, size: number, measure: Measure) => place(node, size, wrap(node, size, measure));

const caches = new WeakMap<Measure, WeakMap<TextNode, TextLayout>>();

/**
 * Lays out a text layer inside its box (single style per layer). `fit: "shrink"` finds the largest size
 * ≤ `node.size` whose layout fits by binary search, to 0.5 px. Cached per (measure, node) since nodes
 * are immutable.
 */
export function layoutText(node: TextNode, measure: Measure): TextLayout {
  let cache = caches.get(measure);
  if (!cache) caches.set(measure, (cache = new WeakMap()));
  const hit = cache.get(node);
  if (hit) return hit;

  let result = layout(node, node.size, measure);
  if (node.fit === "shrink" && result.overflow) {
    let lo = 1;
    let hi = node.size;
    let best = layout(node, lo, measure);
    while (hi - lo > 0.5) {
      const mid = (lo + hi) / 2;
      const attempt = layout(node, mid, measure);
      if (attempt.overflow) hi = mid;
      else {
        lo = mid;
        best = attempt;
      }
    }
    result = best;
  }
  cache.set(node, result);
  return result;
}

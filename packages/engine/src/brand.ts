import type { Doc, Fill, Node, NodeId, TextNode } from "@vash/schema";
import type { Command, NodePatch } from "./commands";
import { layersBelow } from "./hit-test";
import { apply } from "./math";
import { checkPolicy, type EditMode } from "./policy";
import { worldMatrix } from "./scene";

/** A brand kit as the engine needs it: colours as #RRGGBB, fonts from the font list. */
export interface BrandStyle {
  colors: readonly string[];
  fonts: readonly string[];
}

export interface BrandPlan {
  /** One batch (one undo step), or null when nothing would change. */
  command: Command | null;
  /** Layers the plan restyles. */
  changed: number;
  /** Whether the artboard background changes too. */
  background: boolean;
  /** Layers left as they are because the template locked them. */
  skippedLocked: number;
}

type Rgb = [number, number, number];

const base = (color: string) => color.slice(0, 7).toUpperCase();
const alphaOf = (color: string) => color.slice(7);
const rgbOf = (color: string): Rgb => [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255) as Rgb;
const hexOf = (rgb: Rgb) => `#${rgb.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0")).join("")}`.toUpperCase();

/** Near-black and near-white carry contrast (text on paper); a brand colour shouldn't replace them. */
function isNeutral(color: string): boolean {
  const [r, g, b] = rgbOf(color);
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance < 0.08 || luminance > 0.92;
}

/** WCAG contrast ratio of two colours (1 to 21); alpha is ignored. */
function contrast(a: string, b: string): number {
  const channel = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const luminance = (c: string) => {
    const [r, g, b] = rgbOf(c).map(channel) as Rgb;
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

function toHsl([r, g, b]: Rgb): Rgb {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, Math.min(1, d / (1 - Math.abs(2 * l - 1))), l];
}

function fromHsl([h, s, l]: Rgb): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r + m, g + m, b + m];
}

const lightness = (color: string) => toHsl(rgbOf(color))[2];

/** `color` made lighter or darker by `offset` (HSL lightness), so a family of shades keeps its spread. */
function shade(color: string, offset: number): string {
  if (Math.abs(offset) < 0.005) return color;
  const [h, s, l] = toHsl(rgbOf(color));
  return hexOf(fromHsl([h, s, Math.min(0.97, Math.max(0.03, l + offset))]));
}

/** Colours this close (RGB distance, 0 to 255 per channel) are shades of one colour, like a soft gradient's stops. */
const SAME_FAMILY = 48;
const distance = (a: string, b: string) => {
  const [x, y] = [rgbOf(a), rgbOf(b)];
  return Math.hypot(...x.map((v, i) => (v - y[i]!) * 255));
};

function fillColors(fill: Fill | null, area: number, add: (color: string, weight: number) => void): void {
  if (!fill) return;
  if (fill.type === "solid") add(fill.color, area);
  else for (const stop of fill.stops) add(stop.color, area / fill.stops.length);
}

const stopColors = (fill: Fill): string[] => (fill.type === "solid" ? [fill.color] : fill.stops.map((s) => s.color));

/** The design's colours in families of close shades, the family covering the most area first. Each starts with its most covered shade. */
function rankFamilies(doc: Doc): string[][] {
  const weights = new Map<string, number>();
  const add = (color: string, weight: number) => {
    if (isNeutral(color)) return;
    weights.set(base(color), (weights.get(base(color)) ?? 0) + weight);
  };
  fillColors(doc.artboard.background, doc.artboard.width * doc.artboard.height, add);
  for (const node of Object.values(doc.nodes)) {
    const area = node.width * node.height * Math.abs(node.transform.scaleX * node.transform.scaleY);
    if (node.type === "shape") {
      fillColors(node.fill, area, add);
      if (node.stroke) add(node.stroke.color, 2 * (node.width + node.height) * node.stroke.width);
    } else if (node.type === "text") {
      add(node.color, area);
    }
  }
  const families: { colors: string[]; weight: number }[] = [];
  for (const [color, weight] of [...weights].sort((a, b) => b[1] - a[1])) {
    const family = families.find((f) => distance(f.colors[0]!, color) < SAME_FAMILY);
    if (family) {
      family.colors.push(color);
      family.weight += weight;
    } else {
      families.push({ colors: [color], weight });
    }
  }
  return families.sort((a, b) => b.weight - a.weight).map((f) => f.colors);
}

/** Font families by the largest size they're set in: the first is the design's heading font. */
function rankFonts(texts: TextNode[]): string[] {
  const largest = new Map<string, number>();
  for (const t of texts) largest.set(t.font.family, Math.max(largest.get(t.font.family) ?? 0, t.size));
  return [...largest].sort((a, b) => b[1] - a[1]).map(([family]) => family);
}

/** Text should stay this readable against what's behind it (WCAG AA for body text), or as readable as it was if it was already less. */
const READABLE = 4.5;

/**
 * Restyles a design with a brand kit in one undo step. The design's colours, grouped into families of close shades and
 * ranked by the area they cover, become the kit's colours in order: each family's main shade becomes the kit colour and
 * its other shades keep their lightness difference (near-black and near-white stay, transparency is kept). Text that the
 * new colours would make harder to read than before gets a kit colour, black or white that reads instead. The heading
 * font (the one used at the largest size) becomes the kit's first font and every other font its second. Layers the lock
 * policy protects in `mode` are left alone and counted.
 */
export function planBrandKit(doc: Doc, kit: BrandStyle, mode: EditMode): BrandPlan {
  const mapping = new Map<string, string>();
  rankFamilies(doc)
    .slice(0, kit.colors.length)
    .forEach((family, i) => {
      const to = kit.colors[i]!.toUpperCase();
      for (const color of family) mapping.set(color, shade(to, lightness(color) - lightness(family[0]!)));
    });
  const recolor = (color: string) => {
    const to = mapping.get(base(color));
    return to && !isNeutral(color) ? to + alphaOf(color) : color;
  };
  const recolorFill = (fill: Fill | null): Fill | null =>
    !fill ? null : fill.type === "solid" ? { ...fill, color: recolor(fill.color) } : { ...fill, stops: fill.stops.map((s) => ({ ...s, color: recolor(s.color) })) };

  const texts = Object.values(doc.nodes).filter((n): n is TextNode => n.type === "text");
  const fonts = rankFonts(texts);
  const fontFor = (family: string): string | null => {
    if (kit.fonts.length === 0) return null;
    return family === fonts[0] ? kit.fonts[0]! : (kit.fonts[1] ?? kit.fonts[0]!);
  };

  const commands: Command[] = [];
  let changed = 0;
  let skippedLocked = 0;
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const propose = (node: Node, patch: Record<string, unknown>): boolean => {
    if (Object.keys(patch).length === 0) return false;
    const cmd: Command = { type: "update", id: node.id as NodeId, patch: patch as NodePatch };
    if (!checkPolicy(doc, cmd, mode).ok) {
      skippedLocked++;
      return false;
    }
    commands.push(cmd);
    changed++;
    return true;
  };

  const background = recolorFill(doc.artboard.background)!;
  const backgroundChanges = !same(background, doc.artboard.background);
  if (backgroundChanges) commands.push({ type: "artboard", patch: { background } });

  // Shapes first, so text can be checked against the fills it will actually sit on.
  const fills = new Map<NodeId, Fill | null>();
  for (const node of Object.values(doc.nodes)) {
    if (node.type !== "shape") continue;
    const patch: Record<string, unknown> = {};
    const fill = recolorFill(node.fill);
    if (!same(fill, node.fill)) patch.fill = fill;
    if (node.stroke && recolor(node.stroke.color) !== node.stroke.color) patch.stroke = { ...node.stroke, color: recolor(node.stroke.color) };
    if (propose(node, patch) && patch.fill) fills.set(node.id as NodeId, fill);
  }

  /** The colours behind a text layer, before and after, or null over a photo (it can't be read from the document). */
  const backdrop = (node: TextNode): { before: string[]; after: string[] } | null => {
    const centre = apply(worldMatrix(doc, node.id as NodeId), { x: 0, y: 0 });
    for (const id of layersBelow(doc, node.id as NodeId, centre)) {
      const under = doc.nodes[id]!;
      if (under.type === "frame") return null;
      if (under.type !== "shape" || !under.fill || under.opacity < 0.9) continue;
      const colors = stopColors(under.fill);
      if (colors.some((c) => alphaOf(c) && parseInt(alphaOf(c), 16) < 0xe6)) continue;
      return { before: colors, after: stopColors(fills.get(id as NodeId) ?? under.fill) };
    }
    return { before: stopColors(doc.artboard.background), after: stopColors(backgroundChanges ? background : doc.artboard.background) };
  };
  const worst = (color: string, behind: string[]) => Math.min(...behind.map((c) => contrast(color, c)));

  /** The text's new colour, swapped for a kit colour, black or white when it would read worse than before. */
  const readable = (node: TextNode, color: string): string => {
    const behind = backdrop(node);
    if (!behind) return color;
    const needed = Math.min(READABLE, worst(node.color, behind.before));
    if (worst(color, behind.after) >= needed) return color;
    const options = [...kit.colors.map((c) => c.toUpperCase()), base(node.color), "#000000", "#FFFFFF"];
    const pick = options.find((c) => worst(c, behind.after) >= needed) ?? options.reduce((a, b) => (worst(b, behind.after) > worst(a, behind.after) ? b : a));
    return pick + alphaOf(node.color);
  };

  for (const node of texts) {
    const patch: Record<string, unknown> = {};
    const color = readable(node, recolor(node.color));
    if (color !== node.color) patch.color = color;
    const family = fontFor(node.font.family);
    if (family && family !== node.font.family) patch.font = { ...node.font, family };
    propose(node, patch);
  }

  return { command: commands.length > 0 ? { type: "batch", commands } : null, changed, background: backgroundChanges, skippedLocked };
}

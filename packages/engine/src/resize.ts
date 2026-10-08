import { LIMITS, type Doc, type FormatKey, type Node, type NodeId } from "@vash/schema";
import { worldBounds } from "./hit-test";
import { clampContent } from "./photos";

/**
 * "Make the set" (roadmap M4): the same design at another size. Templates carry no layout constraints
 * yet, so the rules are general ones:
 * - Full-bleed layers (an unrotated frame or shape covering the artboard, such as a background photo)
 *   stretch to cover the new artboard. A frame's photo keeps covering it: its zoom is relative to "cover".
 * - Everything else keeps its composition. Sizes scale by the tight side's factor, so it all fits.
 *   Along the side that gained room, distances from the centre grow by up to SPREAD_MAX more, so a
 *   square post fills a story instead of floating in its middle. Spreading never adds overlaps, and
 *   every layer stays on the artboard (each keeps at least its old share of the margin).
 * - Sizes are applied to the layers (font size, width, stroke, group children), never left as a scale.
 */

export interface ResizeTarget {
  format: FormatKey;
  width: number;
  height: number;
}

/** Text that ends up below MIN_POINTS where the design is seen, and smaller there than it was. */
export interface ResizeWarning {
  nodeId: NodeId;
  size: number;
}

const SPREAD_MAX = 1.5;
const FULL_BLEED = 0.95;
/**
 * How wide each format is usually seen, in points: posts, stories, posters and invitations on a phone
 * screen; a thumbnail in a list of videos. Readability is judged there, not in artboard pixels: 40 px on a
 * 1500 px invitation and 29 px on a 1080 px story look the same size.
 */
const SEEN_WIDTH: Record<FormatKey, number> = { "ig-post": 360, "ig-story": 360, poster: 360, invitation: 360, custom: 360, "yt-thumbnail": 320 };
const MIN_POINTS = 9;

const round = (v: number) => Math.round(v * 100) / 100;
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const dim = (v: number) => Math.max(0.01, round(v));

export function resizeDoc(source: Doc, target: ResizeTarget): { doc: Doc; warnings: ResizeWarning[] } {
  const doc = structuredClone(source);
  const { width: W, height: H } = source.artboard;
  const sx = target.width / W;
  const sy = target.height / H;
  const s = Math.min(sx, sy);
  const kx = s * Math.min(SPREAD_MAX, sx / s);
  const ky = s * Math.min(SPREAD_MAX, sy / s);
  const warnings: ResizeWarning[] = [];
  const points = (size: number, format: FormatKey, width: number) => (size * SEEN_WIDTH[format]) / width;

  function scaleNode(id: NodeId): void {
    const node = doc.nodes[id];
    if (!node) return;
    node.width = dim(node.width * s);
    node.height = dim(node.height * s);
    switch (node.type) {
      case "text": {
        const size = clamp(round(node.size * s), LIMITS.fontSizeMin, LIMITS.fontSizeMax);
        const seen = points(size, target.format, target.width);
        if (seen < MIN_POINTS && seen < points(node.size, source.meta.format, W) - 0.01) warnings.push({ nodeId: id, size });
        node.size = size;
        node.letterSpacing = clamp(round(node.letterSpacing * s), -100, 500);
        break;
      }
      case "shape":
        if (node.geometry.kind === "rect") node.geometry = { ...node.geometry, cornerRadius: round(node.geometry.cornerRadius * s) };
        if (node.stroke) node.stroke = { ...node.stroke, width: clamp(round(node.stroke.width * s), 0, LIMITS.strokeWidthMax) };
        break;
      case "frame":
        if (node.shape.kind === "rect") node.shape = { ...node.shape, cornerRadius: round(node.shape.cornerRadius * s) };
        if (node.content) node.content = { ...node.content, offsetX: round(node.content.offsetX * s), offsetY: round(node.content.offsetY * s) };
        break;
      case "group":
        for (const child of node.children) {
          const c = doc.nodes[child];
          if (!c) continue;
          c.transform = { ...c.transform, x: round(c.transform.x * s), y: round(c.transform.y * s) };
          scaleNode(child);
        }
        break;
      case "sticker":
        break;
    }
  }

  function stretch(node: Node): void {
    node.transform = { ...node.transform, x: round(node.transform.x * sx), y: round(node.transform.y * sy) };
    node.width = dim(node.width * sx);
    node.height = dim(node.height * sy);
    const corner = Math.min(sx, sy);
    if (node.type === "shape") {
      if (node.geometry.kind === "rect") node.geometry = { ...node.geometry, cornerRadius: round(node.geometry.cornerRadius * corner) };
      if (node.stroke) node.stroke = { ...node.stroke, width: clamp(round(node.stroke.width * corner), 0, LIMITS.strokeWidthMax) };
    } else if (node.type === "frame") {
      if (node.shape.kind === "rect") node.shape = { ...node.shape, cornerRadius: round(node.shape.cornerRadius * corner) };
      if (node.content) {
        const moved = { ...node.content, offsetX: node.content.offsetX * sx, offsetY: node.content.offsetY * sy };
        const photo = doc.assets[node.content.assetId];
        node.content = { ...node.content, ...(photo ? clampContent(node, photo, moved) : { ...moved, offsetX: round(moved.offsetX), offsetY: round(moved.offsetY) }) };
      }
    }
  }

  for (const id of doc.root) {
    const node = doc.nodes[id];
    if (!node) continue;
    if (isFullBleed(source, id)) {
      stretch(node);
      continue;
    }
    node.transform = {
      ...node.transform,
      x: round(target.width / 2 + (node.transform.x - W / 2) * kx),
      y: round(target.height / 2 + (node.transform.y - H / 2) * ky),
    };
    scaleNode(id);
  }

  doc.artboard = { ...doc.artboard, width: target.width, height: target.height };
  doc.meta = { ...doc.meta, format: target.format };
  return { doc, warnings };
}

/** An unrotated frame or shape whose bounds cover nearly all of the artboard: a background. */
function isFullBleed(doc: Doc, id: NodeId): boolean {
  const node = doc.nodes[id];
  if (!node || (node.type !== "frame" && node.type !== "shape") || node.transform.rotation % 360 !== 0) return false;
  const b = worldBounds(doc, id);
  if (!b) return false;
  const { width: W, height: H } = doc.artboard;
  const covered = Math.max(0, Math.min(b.maxX, W) - Math.max(b.minX, 0)) * Math.max(0, Math.min(b.maxY, H) - Math.max(b.minY, 0));
  return covered >= FULL_BLEED * W * H;
}

import type { Doc, FormatKey, Node, NodeId } from "@vash/schema";
import { worldBounds } from "./hit-test";
import type { Box } from "./math";
import { clampContent } from "./photos";

export interface TargetSize {
  width: number;
  height: number;
  format: FormatKey;
}

/** A layer covering this much of both sides is a backdrop: it stretches to cover the new size. */
const BACKDROP = 0.9;
/** A layer this wide (or tall) runs edge to edge, like a band or divider, and stretches along that side. */
const EDGE_TO_EDGE = 0.9;
/** Ratio of the longer side to the shorter one past which a design counts as portrait or landscape. */
const ORIENTED = 1.15;
/** The photo that leads a split layout must cover at least this share of the design. */
const HERO_AREA = 0.15;

const area = (b: Box) => (b.maxX - b.minX) * (b.maxY - b.minY);
const centre = (b: Box) => ({ x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 });
const inside = (p: { x: number; y: number }, b: Box) => p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY;
const round = (v: number) => Math.round(v * 100) / 100;
const orientation = (w: number, h: number) => (h > w * ORIENTED ? "portrait" : w > h * ORIENTED ? "landscape" : "square");

/** Rect and path outlines may stretch; circles and polygons would distort, so they keep their proportions. */
function stretchable(node: Node): boolean {
  if (node.type === "frame") return node.shape.kind !== "ellipse";
  if (node.type === "shape") return node.geometry.kind === "rect" || node.geometry.kind === "path";
  return node.type === "text";
}

/**
 * `node` with its box resized by `kw` × `kh` and centred on `at`; sizes measured in pixels (type, strokes, corners,
 * letter spacing) follow `k`. A group scales as a whole, so its children keep their arrangement.
 */
function placed(doc: Doc, node: Node, at: { x: number; y: number }, kw: number, kh: number, k: number): Node {
  const transform = { ...node.transform, x: round(at.x), y: round(at.y) };
  if (node.type === "group") return { ...node, transform: { ...transform, scaleX: node.transform.scaleX * k, scaleY: node.transform.scaleY * k } };
  const box = { width: round(node.width * kw), height: round(node.height * kh) };
  switch (node.type) {
    case "text":
      return { ...node, ...box, transform, size: round(node.size * k), letterSpacing: round(node.letterSpacing * k) };
    case "shape": {
      const geometry = node.geometry.kind === "rect" ? { ...node.geometry, cornerRadius: round(node.geometry.cornerRadius * k) } : node.geometry;
      const stroke = node.stroke && { ...node.stroke, width: round(node.stroke.width * k) };
      return { ...node, ...box, transform, geometry, stroke };
    }
    case "frame": {
      const shape = node.shape.kind === "rect" ? { ...node.shape, cornerRadius: round(node.shape.cornerRadius * k) } : node.shape;
      const asset = node.content && doc.assets[node.content.assetId];
      const content =
        node.content && asset
          ? { ...node.content, ...clampContent(box, asset, { ...node.content, offsetX: node.content.offsetX * kw, offsetY: node.content.offsetY * kh }) }
          : node.content;
      return { ...node, ...box, transform, shape, content };
    }
    default:
      return { ...node, ...box, transform };
  }
}

/**
 * One axis of the edge-anchored mapping for a layer spanning `lo`..`hi` with its centre at `c`, from a side of
 * length `from` to one of length `to`, sizes scaled by `k`: a layer in the first third keeps its (scaled) distance from
 * the start, one in the last third from the end, and anything else keeps its relative position.
 */
function anchor(lo: number, hi: number, c: number, from: number, to: number, k: number): number {
  if (lo < from / 3 && hi < (from * 2) / 3) return c * k;
  if (lo > from / 3 && hi > (from * 2) / 3) return to - (from - c) * k;
  return (c / from) * to;
}

/** How far to move a box spanning `lo`..`hi` so it sits inside 0..`max`, or is centred when it is larger. */
const intoView = (lo: number, hi: number, max: number) => (hi - lo > max ? max / 2 - (lo + hi) / 2 : lo < 0 ? -lo : hi > max ? max - hi : 0);

/**
 * The design laid out again at another size, for "Make other sizes". Backdrops stretch to cover the new size and
 * photos stay covering their frames. Between similar shapes (a post and a story) every layer keeps its size relative to
 * the tighter side and holds on to the edge it was near. When a portrait design becomes landscape (or the other way),
 * its largest photo takes one half and the rest of the design stacks in the other, so type doesn't shrink to nothing.
 * Nothing that was inside the design ends up outside it. Locks are kept: the new design is the same template.
 */
export function adaptToSize(doc: Doc, target: TargetSize): Doc {
  const { width: W, height: H } = doc.artboard;
  const { width: W2, height: H2 } = target;
  const sx = W2 / W;
  const sy = H2 / H;
  const s = Math.min(sx, sy);

  const bounds = new Map(doc.root.map((id) => [id, worldBounds(doc, id)!] as const));
  const isBackdrop = (id: NodeId) => {
    const b = bounds.get(id)!;
    return b.maxX - b.minX >= W * BACKDROP && b.maxY - b.minY >= H * BACKDROP;
  };
  const nodes: Doc["nodes"] = { ...doc.nodes };
  const put = (node: Node) => {
    nodes[node.id] = node;
  };

  for (const id of doc.root.filter(isBackdrop)) {
    const node = doc.nodes[id]!;
    put(placed(doc, node, { x: node.transform.x * sx, y: node.transform.y * sy }, sx, sy, s));
  }

  const content = doc.root.filter((id) => !isBackdrop(id));
  const flips = orientation(W, H) !== orientation(W2, H2) && orientation(W, H) !== "square" && orientation(W2, H2) !== "square";
  const hero = flips
    ? content
        .filter((id) => doc.nodes[id]!.type === "frame" && area(bounds.get(id)!) >= W * H * HERO_AREA)
        .sort((a, b) => area(bounds.get(b)!) - area(bounds.get(a)!))[0]
    : undefined;
  const rest = content.filter((id) => id !== hero);

  if (hero && rest.length > 0) {
    split(doc, hero, rest, bounds, target, put);
  } else {
    for (const id of content) {
      const node = doc.nodes[id]!;
      const b = bounds.get(id)!;
      const wide = b.maxX - b.minX >= W * EDGE_TO_EDGE && stretchable(node);
      const tall = b.maxY - b.minY >= H * EDGE_TO_EDGE && stretchable(node);
      const at = {
        x: wide ? node.transform.x * sx : anchor(b.minX, b.maxX, node.transform.x, W, W2, s),
        y: tall ? node.transform.y * sy : anchor(b.minY, b.maxY, node.transform.y, H, H2, s),
      };
      put(placed(doc, node, at, wide ? sx : s, tall ? sy : s, s));
    }
  }

  const laidOut: Doc = { ...doc, meta: { ...doc.meta, format: target.format }, artboard: { ...doc.artboard, width: W2, height: H2 }, nodes };
  const kept: Doc["nodes"] = { ...nodes };
  for (const id of content) {
    const b = bounds.get(id)!;
    if (b.minX < 0 || b.minY < 0 || b.maxX > W || b.maxY > H) continue; // it bled off the edge on purpose
    const now = worldBounds(laidOut, id)!;
    const dx = intoView(now.minX, now.maxX, W2);
    const dy = intoView(now.minY, now.maxY, H2);
    const node = nodes[id]!;
    if (dx || dy) kept[id] = { ...node, transform: { ...node.transform, x: round(node.transform.x + dx), y: round(node.transform.y + dy) } };
  }
  return { ...laidOut, nodes: kept };
}

/**
 * Split layout: the hero photo fills one half (left in landscape, top in portrait) and the remaining layers, with the
 * gap the photo left closed up, are scaled to fit the other half. Layers sitting on the photo move with it.
 */
function split(doc: Doc, hero: NodeId, rest: NodeId[], bounds: Map<NodeId, Box>, target: TargetSize, put: (node: Node) => void): void {
  const { width: W, height: H } = doc.artboard;
  const { width: W2, height: H2 } = target;
  const landscape = W2 > H2;
  const margin = Math.round(Math.min(W2, H2) * 0.05);
  const half = landscape
    ? [{ minX: 0, minY: 0, maxX: W2 / 2, maxY: H2 }, { minX: W2 / 2, minY: 0, maxX: W2, maxY: H2 }]
    : [{ minX: 0, minY: 0, maxX: W2, maxY: H2 / 2 }, { minX: 0, minY: H2 / 2, maxX: W2, maxY: H2 }];
  const inset = (b: Box): Box => ({ minX: b.minX + margin, minY: b.minY + margin, maxX: b.maxX - margin, maxY: b.maxY - margin });
  const [heroArea, restArea] = [inset(half[0]!), inset(half[1]!)];

  // The hero takes its half; a round photo stays round.
  const heroNode = doc.nodes[hero]!;
  const hb = bounds.get(hero)!;
  const hw = hb.maxX - hb.minX;
  const hh = hb.maxY - hb.minY;
  const fit = Math.min((heroArea.maxX - heroArea.minX) / hw, (heroArea.maxY - heroArea.minY) / hh);
  const [kw, kh] = stretchable(heroNode) ? [(heroArea.maxX - heroArea.minX) / hw, (heroArea.maxY - heroArea.minY) / hh] : [fit, fit];
  const heroK = Math.min(kw, kh);
  const heroAt = centre(heroArea);
  put(placed(doc, heroNode, heroAt, kw, kh, heroK));

  // Layers drawn on top of the photo go with it.
  const heroCentre = centre(hb);
  const order = doc.root.indexOf(hero);
  const onHero = rest.filter((id) => doc.root.indexOf(id) > order && inside(centre(bounds.get(id)!), hb));
  for (const id of onHero) {
    const node = doc.nodes[id]!;
    put(placed(doc, node, { x: heroAt.x + (node.transform.x - heroCentre.x) * kw, y: heroAt.y + (node.transform.y - heroCentre.y) * kh }, heroK, heroK, heroK));
  }

  // Close the gap the photo leaves along the axis the design is read in.
  const others = rest.filter((id) => !onHero.includes(id));
  if (others.length === 0) return;
  const [lo, hi] = landscape ? (["minY", "maxY"] as const) : (["minX", "maxX"] as const);
  const before = others.filter((id) => bounds.get(id)![hi] <= hb[lo]);
  const after = others.filter((id) => bounds.get(id)![lo] >= hb[hi]);
  const gapBefore = before.length ? hb[lo] - Math.max(...before.map((id) => bounds.get(id)![hi])) : 0;
  const gapAfter = after.length ? Math.min(...after.map((id) => bounds.get(id)![lo])) - hb[hi] : 0;
  const pull = before.length && after.length ? gapBefore + (hb[hi] - hb[lo]) + gapAfter - Math.min(gapBefore, gapAfter) : 0;
  const shifted = new Map(
    others.map((id) => {
      const b = bounds.get(id)!;
      const d = after.includes(id) ? pull : 0;
      return [id, landscape ? { ...b, minY: b.minY - d, maxY: b.maxY - d } : { ...b, minX: b.minX - d, maxX: b.maxX - d }] as const;
    }),
  );

  // Fit what's left into the other half, never bigger than the short sides allow.
  const all = [...shifted.values()];
  const box = { minX: Math.min(...all.map((b) => b.minX)), minY: Math.min(...all.map((b) => b.minY)), maxX: Math.max(...all.map((b) => b.maxX)), maxY: Math.max(...all.map((b) => b.maxY)) };
  const k = Math.min((restArea.maxX - restArea.minX) / (box.maxX - box.minX), (restArea.maxY - restArea.minY) / (box.maxY - box.minY), Math.min(W2, H2) / Math.min(W, H));
  const from = centre(box);
  const to = centre(restArea);
  for (const id of others) {
    const node = doc.nodes[id]!;
    const b = shifted.get(id)!;
    const original = bounds.get(id)!;
    const c = { x: node.transform.x + (b.minX - original.minX), y: node.transform.y + (b.minY - original.minY) };
    put(placed(doc, node, { x: to.x + (c.x - from.x) * k, y: to.y + (c.y - from.y) * k }, k, k, k));
  }
}

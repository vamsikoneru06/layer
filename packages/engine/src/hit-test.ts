import type { Doc, Node, NodeId, ShapeGeometry } from "@vash/schema";
import { aabb, apply, boxCorners, invert, type Box, type Point } from "./math";
import { insideRings, insideRoundRect, nearRings, pathRings, polygonRing } from "./outline";
import { drawOrder, topLevelOf, worldMatrix } from "./scene";

const outlineOf = (node: Node): ShapeGeometry | null => (node.type === "shape" ? node.geometry : node.type === "frame" ? node.shape : null);

/** Is a point in the node's own (centred) coordinates inside it? Shapes and frames are tested by their exact outline. */
function containsLocal(node: Node, p: Point, pad: number): boolean {
  const { width: w, height: h } = node;
  const hw = w / 2 + pad;
  const hh = h / 2 + pad;
  if (Math.abs(p.x) > hw || Math.abs(p.y) > hh) return false;
  const outline = outlineOf(node);
  switch (outline?.kind) {
    case "ellipse":
      return hw > 0 && hh > 0 && (p.x / hw) ** 2 + (p.y / hh) ** 2 <= 1;
    case "rect":
      return insideRoundRect(p, w, h, outline.cornerRadius, pad);
    case "polygon": {
      const rings = [polygonRing(outline.sides, w, h)];
      return insideRings(rings, p) || nearRings(rings, p, pad);
    }
    case "path": {
      const rings = pathRings(outline.d, w, h);
      return insideRings(rings, p) || nearRings(rings, p, pad);
    }
    default:
      return true;
  }
}

/**
 * The topmost visible leaf layer under `point` (artboard coordinates), or null. A linear scan from the
 * top: fine for the ≤ 500 layers a document may hold (spec §7).
 */
export function hitTest(doc: Doc, point: Point, pad = 0): NodeId | null {
  const order = drawOrder(doc);
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i]!;
    const node = doc.nodes[id];
    const inverse = node && invert(worldMatrix(doc, id));
    if (inverse && containsLocal(node, apply(inverse, point), pad)) return id;
  }
  return null;
}

const intersects = (a: Box, b: Box) => a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;

/** Axis-aligned world bounds of a node. */
export function worldBounds(doc: Doc, id: NodeId): Box | null {
  const node = doc.nodes[id];
  return node ? aabb(boxCorners(node.width, node.height, worldMatrix(doc, id))) : null;
}

/** Top-level layers (in paint order) whose bounds touch `box`: what a marquee selects. */
export function nodesInBox(doc: Doc, box: Box): NodeId[] {
  const picked: NodeId[] = [];
  for (const id of drawOrder(doc)) {
    const bounds = worldBounds(doc, id);
    const top = topLevelOf(doc, id);
    if (bounds && intersects(bounds, box) && !picked.includes(top)) picked.push(top);
  }
  return picked;
}

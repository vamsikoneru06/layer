import type { Doc, Node, NodeId } from "@vash/schema";
import { aabb, apply, boxCorners, invert, type Box, type Point } from "./math";
import { drawOrder, topLevelOf, worldMatrix } from "./scene";

function isEllipse(node: Node): boolean {
  return (node.type === "shape" && node.geometry.kind === "ellipse") || (node.type === "frame" && node.shape.kind === "ellipse");
}

/** Is a point in the node's own (centred) coordinates inside it? Polygons and paths use their box for now. */
function containsLocal(node: Node, p: Point, pad: number): boolean {
  const hw = node.width / 2 + pad;
  const hh = node.height / 2 + pad;
  if (isEllipse(node)) return hw > 0 && hh > 0 && (p.x / hw) ** 2 + (p.y / hh) ** 2 <= 1;
  return Math.abs(p.x) <= hw && Math.abs(p.y) <= hh;
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

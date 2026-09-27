import type { Doc, NodeId } from "@vash/schema";
import { fromTransform, IDENTITY, multiply, type Mat } from "./math";

/**
 * Derived, read-only views of a document. Documents are immutable, so each view is computed once
 * per document object and cached; an edit produces a new document and a fresh view.
 */
interface SceneIndex {
  order: NodeId[];
  parents: Map<NodeId, NodeId>;
  world: Map<NodeId, Mat>;
}

const cache = new WeakMap<Doc, SceneIndex>();

function index(doc: Doc): SceneIndex {
  const hit = cache.get(doc);
  if (hit) return hit;
  const order: NodeId[] = [];
  const parents = new Map<NodeId, NodeId>();
  const world = new Map<NodeId, Mat>();

  const visit = (id: NodeId, parentWorld: Mat, visible: boolean, parent: NodeId | null) => {
    const node = doc.nodes[id];
    if (!node) return;
    if (parent) parents.set(id, parent);
    const m = multiply(parentWorld, fromTransform(node.transform));
    world.set(id, m);
    const shown = visible && node.visible;
    if (node.type === "group") {
      for (const child of node.children) visit(child, m, shown, id);
    } else if (shown) {
      order.push(id);
    }
  };
  for (const id of doc.root) visit(id, IDENTITY, true, null);

  const built = { order, parents, world };
  cache.set(doc, built);
  return built;
}

/** Visible leaf layers, bottom to top; a group's children are painted where the group sits. */
export const drawOrder = (doc: Doc): readonly NodeId[] => index(doc).order;

/** Node-local → artboard space. Unknown ids get the identity. */
export const worldMatrix = (doc: Doc, id: NodeId): Mat => index(doc).world.get(id) ?? IDENTITY;

export const parentOf = (doc: Doc, id: NodeId): NodeId | null => index(doc).parents.get(id) ?? null;

/** The root-level layer containing `id` (itself when it is top-level). Clicks select at this level. */
export function topLevelOf(doc: Doc, id: NodeId): NodeId {
  const parents = index(doc).parents;
  let current = id;
  for (let parent = parents.get(current); parent; parent = parents.get(current)) current = parent;
  return current;
}

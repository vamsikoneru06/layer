import type { Doc, Node, NodeId } from "@vash/schema";
import type { Command } from "./commands";
import { newNodeId } from "./insert";
import type { EditMode } from "./policy";
import { parentOf } from "./scene";
import { layerLimit, nodeCap, refuse, siblingsOf, subtreeOf, topLevelSelection, type Plan } from "./selection-utils";

/** How far a duplicate or a pasted layer lands from the original, in artboard units. */
export const DUPLICATE_OFFSET = 20;

export interface CloneOptions {
  dx: number;
  dy: number;
  /** A user's own copy of a locked template layer is theirs to edit. */
  freeLocks: boolean;
}

/** Copies of `id` and its descendants under fresh ids. Only the top copy is moved by (dx, dy). */
export function cloneSubtree(get: (id: NodeId) => Node | undefined, id: NodeId, o: CloneOptions): Node[] {
  const source = subtreeOf(get, id);
  const fresh = new Map(source.map((n) => [n.id, newNodeId()]));
  return source.map((n): Node => {
    const shared = {
      id: fresh.get(n.id)!,
      transform: n.id === id ? { ...n.transform, x: n.transform.x + o.dx, y: n.transform.y + o.dy } : n.transform,
      lock: o.freeLocks ? ("free" as const) : n.lock,
    };
    return n.type === "group" ? { ...n, ...shared, children: n.children.map((c) => fresh.get(c)!) } : { ...n, ...shared };
  });
}

/** Copies the selected layers to the top of their stacks, a little to the side, and selects the copies. */
export function planDuplicate(doc: Doc, ids: readonly NodeId[], mode: EditMode): Plan {
  const roots = topLevelSelection(doc, ids);
  if (roots.length === 0) return refuse("Select a layer to duplicate.");
  const options = { dx: DUPLICATE_OFFSET, dy: DUPLICATE_OFFSET, freeLocks: mode === "design" };
  const copies = roots.map((id) => cloneSubtree((n) => doc.nodes[n], id, options));
  if (Object.keys(doc.nodes).length + copies.reduce((sum, c) => sum + c.length, 0) > nodeCap(doc)) return refuse(layerLimit(doc));

  const added = new Map<NodeId | null, number>();
  const commands = roots.map((id, i): Command => {
    const parent = parentOf(doc, id);
    const soFar = added.get(parent) ?? 0;
    added.set(parent, soFar + 1);
    return { type: "insert", nodes: copies[i]!, parent, index: siblingsOf(doc, parent).length + soFar };
  });
  return { ok: true, command: { type: "batch", commands }, select: copies.map((c) => c[0]!.id) };
}

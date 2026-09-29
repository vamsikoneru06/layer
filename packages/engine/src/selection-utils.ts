import { LIMITS, type Doc, type Node, type NodeId } from "@vash/schema";
import type { Command } from "./commands";
import { parentOf } from "./scene";

/** What an edit will do, worked out before anything changes: the command and what to select after, or why not. */
export type Plan = { ok: true; command: Command; select: NodeId[]; notice?: string } | { ok: false; reason: string };

export const refuse = (reason: string): Plan => ({ ok: false, reason });

/** Child list of `parent` (null = the document root). */
export function siblingsOf(doc: Doc, parent: NodeId | null): readonly NodeId[] {
  if (parent === null) return doc.root;
  const node = doc.nodes[parent];
  return node?.type === "group" ? node.children : [];
}

/** `id` followed by all its descendants, parents before children. */
export function subtreeOf(get: (id: NodeId) => Node | undefined, id: NodeId): Node[] {
  const node = get(id);
  if (!node) return [];
  return node.type === "group" ? [node, ...node.children.flatMap((child) => subtreeOf(get, child))] : [node];
}

/** The selected layers that are not inside another selected layer, bottom of the stack first. */
export function topLevelSelection(doc: Doc, ids: readonly NodeId[]): NodeId[] {
  const picked = new Set(ids.filter((id) => doc.nodes[id]));
  const keep = [...picked].filter((id) => {
    for (let p = parentOf(doc, id); p; p = parentOf(doc, p)) if (picked.has(p)) return false;
    return true;
  });
  const order = new Map<NodeId, number>();
  const walk = (list: readonly NodeId[]) =>
    list.forEach((id) => {
      order.set(id, order.size);
      const node = doc.nodes[id];
      if (node?.type === "group") walk(node.children);
    });
  walk(doc.root);
  return keep.sort((a, b) => order.get(a)! - order.get(b)!);
}

export const nodeCap = (doc: Doc): number => (doc.kind === "template" ? LIMITS.templateNodes : LIMITS.designNodes);

export const layerLimit = (doc: Doc): string => `A design can have up to ${nodeCap(doc)} layers.`;

import type { Doc, Node, NodeId } from "@vash/schema";

/** Every document edit is one of these. Applying one yields the new document and the command that undoes it. */
export type Command =
  | { type: "update"; id: NodeId; patch: Partial<Omit<Node, "id" | "type" | "children">> }
  /** `nodes[0]` goes into `parent` (null = root) at `index`; any further nodes are its descendants. */
  | { type: "insert"; nodes: Node[]; parent: NodeId | null; index: number }
  /** Removes the node and, for a group, everything inside it. */
  | { type: "delete"; id: NodeId }
  /** Moves the node to `index` within its current parent. */
  | { type: "reorder"; id: NodeId; index: number }
  | { type: "batch"; commands: Command[] };

export interface Applied {
  doc: Doc;
  inverse: Command;
}

const NOOP: Command = { type: "batch", commands: [] };

function parentOfId(doc: Doc, id: NodeId): NodeId | null {
  for (const node of Object.values(doc.nodes)) {
    if (node.type === "group" && node.children.includes(id)) return node.id;
  }
  return null;
}

function siblings(doc: Doc, parent: NodeId | null): NodeId[] {
  if (parent === null) return doc.root;
  const node = doc.nodes[parent];
  return node?.type === "group" ? node.children : [];
}

/** Returns a doc whose child list for `parent` is replaced (root or a group's children). */
function withSiblings(doc: Doc, parent: NodeId | null, list: NodeId[], nodes: Doc["nodes"] = doc.nodes): Doc {
  if (parent === null) return { ...doc, nodes, root: list };
  const group = nodes[parent];
  if (group?.type !== "group") return { ...doc, nodes };
  return { ...doc, nodes: { ...nodes, [parent]: { ...group, children: list } } };
}

function subtree(doc: Doc, id: NodeId): Node[] {
  const node = doc.nodes[id];
  if (!node) return [];
  return node.type === "group" ? [node, ...node.children.flatMap((c) => subtree(doc, c))] : [node];
}

const clampIndex = (index: number, length: number) => Math.max(0, Math.min(length, Math.trunc(index)));

export function applyCommand(doc: Doc, cmd: Command): Applied {
  switch (cmd.type) {
    case "update": {
      const node = doc.nodes[cmd.id];
      if (!node) return { doc, inverse: NOOP };
      const previous: Record<string, unknown> = {};
      for (const key of Object.keys(cmd.patch)) previous[key] = (node as unknown as Record<string, unknown>)[key];
      const next = { ...node, ...cmd.patch } as Node;
      return {
        doc: { ...doc, nodes: { ...doc.nodes, [cmd.id]: next } },
        inverse: { type: "update", id: cmd.id, patch: previous as Extract<Command, { type: "update" }>["patch"] },
      };
    }

    case "insert": {
      const [top] = cmd.nodes;
      if (!top || doc.nodes[top.id]) return { doc, inverse: NOOP };
      const nodes = { ...doc.nodes };
      for (const n of cmd.nodes) nodes[n.id] = n;
      const list = [...siblings(doc, cmd.parent)];
      list.splice(clampIndex(cmd.index, list.length), 0, top.id);
      return { doc: withSiblings(doc, cmd.parent, list, nodes), inverse: { type: "delete", id: top.id } };
    }

    case "delete": {
      if (!doc.nodes[cmd.id]) return { doc, inverse: NOOP };
      const parent = parentOfId(doc, cmd.id);
      const list = siblings(doc, parent);
      const index = list.indexOf(cmd.id);
      const removed = subtree(doc, cmd.id);
      const nodes = { ...doc.nodes };
      for (const n of removed) delete nodes[n.id];
      return {
        doc: withSiblings(doc, parent, list.filter((x) => x !== cmd.id), nodes),
        inverse: { type: "insert", nodes: removed, parent, index },
      };
    }

    case "reorder": {
      if (!doc.nodes[cmd.id]) return { doc, inverse: NOOP };
      const parent = parentOfId(doc, cmd.id);
      const list = [...siblings(doc, parent)];
      const from = list.indexOf(cmd.id);
      list.splice(from, 1);
      list.splice(clampIndex(cmd.index, list.length), 0, cmd.id);
      return { doc: withSiblings(doc, parent, list), inverse: { type: "reorder", id: cmd.id, index: from } };
    }

    case "batch": {
      let current = doc;
      const inverses: Command[] = [];
      for (const c of cmd.commands) {
        const r = applyCommand(current, c);
        current = r.doc;
        inverses.unshift(r.inverse);
      }
      return { doc: current, inverse: { type: "batch", commands: inverses } };
    }
  }
}

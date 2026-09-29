import { LIMITS, type Doc, type Node, type NodeId } from "@vash/schema";
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

/** Copied layers travel as text, so they work across tabs and the system clipboard. */
export const CLIPBOARD_PREFIX = "vash:";

const NOTHING_TO_PASTE = "Nothing to paste.";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The selected layers (top-level ones, with their descendants) as clipboard text, or null for an empty selection. */
export function serializeSelection(doc: Doc, ids: readonly NodeId[]): string | null {
  const roots = topLevelSelection(doc, ids);
  if (roots.length === 0) return null;
  const nodes = roots.flatMap((id) => subtreeOf((n) => doc.nodes[n], id));
  return CLIPBOARD_PREFIX + JSON.stringify({ v: 1, roots, nodes });
}

function parsePayload(text: string): { roots: NodeId[]; nodes: Node[] } | null {
  if (!text.startsWith(CLIPBOARD_PREFIX) || text.length > LIMITS.docBytes) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(CLIPBOARD_PREFIX.length));
  } catch {
    return null;
  }
  if (!isRecord(raw) || raw.v !== 1 || !Array.isArray(raw.roots) || !Array.isArray(raw.nodes) || raw.roots.length === 0) return null;
  if (!raw.roots.every((r) => typeof r === "string") || !raw.nodes.every((n) => isRecord(n) && typeof n.id === "string")) return null;
  return { roots: raw.roots as NodeId[], nodes: raw.nodes as Node[] };
}

/**
 * Pastes clipboard text at the top of the root, a little to the side. The text is untrusted: layers
 * that need a photo or sticker this design does not already use are left out (and the notice says so),
 * and `runPlan` validates the whole result before anything is applied.
 */
export function planPaste(doc: Doc, text: string, mode: EditMode): Plan {
  const payload = parsePayload(text);
  if (!payload) return refuse(NOTHING_TO_PASTE);
  // Real copies never hold more layers than a design can, so this also bounds nesting depth (no stack overflow below).
  if (payload.nodes.length > nodeCap(doc)) return refuse(layerLimit(doc));
  const byId = new Map<NodeId, Node>();
  for (const n of payload.nodes) {
    if (byId.has(n.id)) return refuse(NOTHING_TO_PASTE);
    byId.set(n.id, n);
  }
  // Each layer may be referenced once (as a root or as one group's child). A layer shared by several
  // groups would make `prune` below visit it once per path, which is exponential on a hostile payload.
  const referenced = new Set<NodeId>();
  for (const id of [...payload.roots, ...payload.nodes.flatMap((n) => (n.type === "group" && Array.isArray(n.children) ? n.children : []))]) {
    if (referenced.has(id)) return refuse(NOTHING_TO_PASTE);
    referenced.add(id);
  }

  let dropped = 0;
  const known = (assetId: unknown) => typeof assetId === "string" && Object.hasOwn(doc.assets, assetId);
  // The layer and its descendants with unusable ones removed; null when nothing is left of it.
  const prune = (id: NodeId, path: ReadonlySet<NodeId>): Node[] | null => {
    const n = byId.get(id);
    if (!n || path.has(id)) return null;
    if (n.type === "group") {
      if (!Array.isArray(n.children)) return null;
      const inside = new Set(path).add(id);
      const kept = n.children.map((child) => prune(child, inside)).filter((k): k is Node[] => k !== null);
      return kept.length === 0 ? null : [{ ...n, children: kept.map((k) => k[0]!.id) }, ...kept.flat()];
    }
    const usesAsset = n.type === "sticker" || (n.type === "frame" && n.content != null);
    const assetId = n.type === "sticker" ? n.assetId : n.type === "frame" ? n.content?.assetId : undefined;
    if (usesAsset && !known(assetId)) {
      dropped++;
      return null;
    }
    return [n];
  };

  const kept = payload.roots.map((id) => prune(id, new Set())).filter((k): k is Node[] => k !== null);
  if (kept.length === 0) return refuse(dropped > 0 ? "Photos can only be pasted into a design that already uses them." : NOTHING_TO_PASTE);

  const local = new Map(kept.flat().map((n) => [n.id, n] as const));
  let copies: Node[][];
  try {
    copies = kept.map((nodes) => cloneSubtree((id) => local.get(id), nodes[0]!.id, { dx: DUPLICATE_OFFSET, dy: DUPLICATE_OFFSET, freeLocks: mode === "design" }));
  } catch {
    return refuse(NOTHING_TO_PASTE); // a node with missing or malformed fields
  }
  if (Object.keys(doc.nodes).length + copies.reduce((sum, c) => sum + c.length, 0) > nodeCap(doc)) return refuse(layerLimit(doc));

  const command: Command = {
    type: "batch",
    commands: copies.map((nodes, i): Command => ({ type: "insert", nodes, parent: null, index: doc.root.length + i })),
  };
  const notice = dropped > 0 ? "Some photos weren't pasted because this design doesn't use them." : undefined;
  return { ok: true, command, select: copies.map((c) => c[0]!.id), ...(notice ? { notice } : {}) };
}

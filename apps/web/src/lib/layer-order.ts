import type { Node, NodeId } from "@vash/schema";

const TYPE_NAMES: Record<Node["type"], string> = { frame: "Photo", text: "Text", shape: "Shape", sticker: "Sticker", group: "Group" };

/** The name shown for a layer: its own name, or a readable name for its kind when it has none. */
export const layerName = (node: Pick<Node, "name" | "type">): string => node.name.trim() || TYPE_NAMES[node.type];

/**
 * Where a layer lands when dropped on one side of another layer in the same sibling list. `list` runs
 * bottom to top, but the panel shows it top first, so a line above a row is the position after it in
 * `list`. The result is the final index (what `moveLayer` takes: the position counted without the
 * dragged layer), or null when the drop is not among these siblings or would change nothing.
 */
export function dropIndex(list: readonly NodeId[], dragged: NodeId, over: NodeId, edge: "above" | "below"): number | null {
  const from = list.indexOf(dragged);
  const at = list.indexOf(over);
  if (from < 0 || at < 0 || from === at) return null;
  const slot = edge === "above" ? at + 1 : at; // insert before this position of the current list
  const index = slot > from ? slot - 1 : slot;
  return index === from ? null : index;
}

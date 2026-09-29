import type { Doc, GroupNode, Node, NodeId } from "@vash/schema";
import type { Command } from "./commands";
import { newNodeId } from "./insert";
import { aabb, boxCorners, decompose, fromTransform, matricesClose, multiply } from "./math";
import { checkPolicy, type EditMode } from "./policy";
import { parentOf } from "./scene";
import { refuse, siblingsOf, subtreeOf, topLevelSelection, type Plan } from "./selection-utils";

const positionOf = (doc: Doc, id: NodeId) => siblingsOf(doc, parentOf(doc, id)).indexOf(id);

/** Turns a plan into a refusal when a lock forbids its commands. */
function allowed(doc: Doc, command: Command, mode: EditMode, select: NodeId[]): Plan {
  const verdict = checkPolicy(doc, command, mode);
  return verdict.ok ? { ok: true, command, select } : refuse(verdict.reason);
}

/**
 * Wraps two or more layers of the same level in a new group. The group only translates (to the centre
 * of its members), so each member keeps its own rotation and scale and stays exactly where it was.
 */
export function planGroup(doc: Doc, ids: readonly NodeId[], mode: EditMode): Plan {
  const roots = topLevelSelection(doc, ids);
  if (roots.length < 2) return refuse("Select two or more layers to group.");
  const parent = parentOf(doc, roots[0]!);
  if (roots.some((id) => parentOf(doc, id) !== parent)) return refuse("Select layers at the same level to group them.");

  const list = siblingsOf(doc, parent);
  const ordered = [...roots].sort((a, b) => list.indexOf(a) - list.indexOf(b));
  const members = ordered.map((id) => doc.nodes[id]!);
  const box = aabb(members.flatMap((n) => boxCorners(n.width, n.height, fromTransform(n.transform))));
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;

  const created: GroupNode = {
    id: newNodeId(),
    type: "group",
    name: "Group",
    transform: { x: cx, y: cy, rotation: 0, scaleX: 1, scaleY: 1 },
    width: Math.max(1, box.maxX - box.minX),
    height: Math.max(1, box.maxY - box.minY),
    opacity: 1,
    visible: true,
    lock: "free",
    children: ordered,
  };
  const moved = ordered.flatMap((id): Node[] => {
    const [top, ...rest] = subtreeOf((n) => doc.nodes[n], id);
    return [{ ...top!, transform: { ...top!.transform, x: top!.transform.x - cx, y: top!.transform.y - cy } }, ...rest];
  });
  const command: Command = {
    type: "batch",
    commands: [
      ...ordered.map((id): Command => ({ type: "delete", id })),
      // Every member sits below the topmost one, and they are all removed first, so the group takes its place.
      { type: "insert", nodes: [created, ...moved], parent, index: list.indexOf(ordered.at(-1)!) - (ordered.length - 1) },
    ],
  };
  return allowed(doc, command, mode, [created.id]);
}

/**
 * Replaces each selected group by its children, in the group's place in the stack. A child's new
 * transform is the group's matrix times its own; if that would need shear the drawing could change,
 * so the whole ungroup is refused.
 */
export function planUngroup(doc: Doc, ids: readonly NodeId[], mode: EditMode): Plan {
  const top = topLevelSelection(doc, ids);
  const groups = top.filter((id) => doc.nodes[id]?.type === "group");
  if (groups.length === 0) return refuse("Select a group to ungroup.");

  const commands: Command[] = [];
  const select = top.filter((id) => !groups.includes(id));
  // Highest position first, so replacing one group never shifts the index of another in the same list.
  for (const id of [...groups].sort((a, b) => positionOf(doc, b) - positionOf(doc, a))) {
    const g = doc.nodes[id] as GroupNode;
    const parent = parentOf(doc, id);
    const at = positionOf(doc, id);
    const groupMatrix = fromTransform(g.transform);
    const lifted: Node[][] = [];
    for (const childId of g.children) {
      const child = doc.nodes[childId];
      if (!child) continue;
      const m = multiply(groupMatrix, fromTransform(child.transform));
      const transform = decompose(m);
      if (!matricesClose(fromTransform(transform), m)) return refuse("This group is stretched too far to ungroup.");
      const [self, ...rest] = subtreeOf((n) => doc.nodes[n], childId);
      lifted.push([{ ...self!, transform, opacity: self!.opacity * g.opacity, visible: self!.visible && g.visible }, ...rest]);
    }
    commands.push({ type: "delete", id }, ...lifted.map((nodes, i): Command => ({ type: "insert", nodes, parent, index: at + i })));
    select.push(...lifted.map((nodes) => nodes[0]!.id));
  }
  return allowed(doc, { type: "batch", commands }, mode, select);
}

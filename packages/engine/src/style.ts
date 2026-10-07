import type { Doc, Node, NodeId, NodeType } from "@vash/schema";
import type { Command, NodePatch } from "./commands";
import type { EditMode } from "./policy";
import { checked, refuse, topLevelSelection, type Plan } from "./selection-utils";

type NodeOf<T extends NodeType> = Extract<Node, { type: T }>;

/**
 * The fields "Copy style" carries, per node type. Left out everywhere: identity (id, type, name), lock
 * and visible (state, not look), and geometry (transform, width, height), which belong to the layer
 * rather than its look. Also left out, per type:
 * - frame: `content` (the photo and its crop), `shape` (the mask is the frame's form, like its size)
 *   and `placeholder` (a marker for an empty slot, not a look).
 * - text: `content`, and `maxChars`, which limits what can be typed: pasting a limit below the
 *   existing text would make the layer invalid.
 * - shape: `geometry` (rect, ellipse, polygon or path is what the shape is).
 * - sticker: `assetId` (which picture it is).
 * - group: `children`.
 */
export const STYLE_FIELDS: { readonly [T in NodeType]: readonly (keyof NodeOf<T>)[] } = {
  frame: ["opacity", "filters"],
  text: ["opacity", "font", "size", "color", "align", "lineHeight", "letterSpacing", "fit"],
  shape: ["opacity", "fill", "stroke"],
  sticker: ["opacity"],
  group: ["opacity"],
};

/** A copied style: the node type it came from and a snapshot of its style fields. */
export interface Style {
  type: NodeType;
  fields: Record<string, unknown>;
}

/** Snapshot of a layer's style (a deep copy, so it stays as copied whatever happens to the layer). */
export function styleOf(node: Node): Style {
  const source = node as unknown as Record<string, unknown>;
  const fields: Record<string, unknown> = {};
  for (const key of STYLE_FIELDS[node.type] as readonly string[]) fields[key] = structuredClone(source[key]);
  return { type: node.type, fields };
}

const layers = (n: number) => `${n} layer${n === 1 ? "" : "s"}`;

/** Puts a copied style on every selected top-level layer of the same type. Other types are skipped, and the notice says how many. */
export function planPasteStyle(doc: Doc, selection: readonly NodeId[], mode: EditMode, style: Style | null | undefined): Plan {
  if (!style) return refuse("Copy a style first.");
  const roots = topLevelSelection(doc, selection);
  if (roots.length === 0) return refuse("Select a layer first.");
  const matching = roots.filter((id) => doc.nodes[id]!.type === style.type);
  if (matching.length === 0) return refuse("These layers are a different kind, so the style wasn't pasted.");

  const skipped = roots.length - matching.length;
  const notice = skipped > 0 ? `Style pasted to ${layers(matching.length)}. ${layers(skipped)} of another kind ${skipped === 1 ? "was" : "were"} skipped.` : undefined;
  const commands = matching.map((id): Command => ({ type: "update", id, patch: structuredClone(style.fields) as NodePatch }));
  return checked(doc, { type: "batch", commands }, mode, selection, notice);
}

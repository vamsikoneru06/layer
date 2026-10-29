import { defaultFilters, referencedAssetIds, type AssetRef, type Doc, type FrameNode, type NodeId } from "@vash/schema";
import type { Command } from "./commands";
import { isNeutral } from "./filters";
import { clampContent } from "./photos";
import type { EditMode } from "./policy";
import { checked, refuse, type Plan } from "./selection-utils";

const SELECT_PHOTO = "Select a photo first.";

/** The selected frames, each once. Other layers in the selection are ignored. */
function selectedFrames(doc: Doc, selection: readonly NodeId[]): FrameNode[] {
  return [...new Set(selection)].flatMap((id) => {
    const node = doc.nodes[id];
    return node?.type === "frame" ? [node] : [];
  });
}

/** No adjustments at all: no preset, every slider at zero, no duotone and no pixelate. */
const isPlain = (frame: FrameNode): boolean => !frame.filters.preset && isNeutral(frame.filters);

/**
 * Sets the selected photo frames back to unadjusted filters (one update each, one undo step). Frames that are
 * already plain are left alone; if none of them need a change, the plan is refused.
 */
export function planResetFilters(doc: Doc, selection: readonly NodeId[], mode: EditMode): Plan {
  const frames = selectedFrames(doc, selection);
  if (frames.length === 0) return refuse(SELECT_PHOTO);
  const commands = frames.filter((f) => !isPlain(f)).map((f): Command => ({ type: "update", id: f.id, patch: { filters: defaultFilters() } }));
  if (commands.length === 0) return refuse("This photo has no adjustments to reset.");
  return checked(doc, { type: "batch", commands }, mode, selection);
}

/**
 * Swaps the photo in a frame that already holds one. The frame keeps its filters and, where they still cover the
 * frame, its offset and zoom (clamped otherwise, so no edge of the new photo shows empty). The new photo is added
 * to the asset list in the same step, and the old photo is dropped from it if nothing else shows it.
 */
export function planReplacePhoto(doc: Doc, frameId: NodeId, asset: AssetRef, mode: EditMode): Plan {
  const node = doc.nodes[frameId];
  if (node?.type !== "frame") return refuse(SELECT_PHOTO);
  if (!node.content) return refuse("Drop a photo onto the frame first.");
  const previous = node.content.assetId;
  if (previous === asset.id) return refuse("That photo is already in this frame.");

  const content = { ...node.content, assetId: asset.id, ...clampContent(node, asset, node.content) };
  const after = referencedAssetIds({ ...doc, nodes: { ...doc.nodes, [frameId]: { ...node, content } } });
  const commands: Command[] = [];
  if (!doc.assets[asset.id]) commands.push({ type: "asset", id: asset.id, ref: asset });
  commands.push({ type: "update", id: frameId, patch: { content } });
  if (doc.assets[previous] && !after.has(previous)) commands.push({ type: "asset", id: previous, ref: null });
  return checked(doc, { type: "batch", commands }, mode, [frameId]);
}

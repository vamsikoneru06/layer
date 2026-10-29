import type { Command } from "@vash/engine";
import type { AssetId, AssetRef, Doc, Fill } from "@vash/schema";

/** A background photo: covers the artboard, cropped to fit (the only fit for now). */
export function imageFill(assetId: AssetId): Fill {
  return { type: "image", assetId, fit: "cover" };
}

/** Whether a frame or a sticker still shows the photo. The background itself does not count. */
function shownByLayers(doc: Doc, assetId: AssetId): boolean {
  return Object.values(doc.nodes).some((n) => (n.type === "frame" && n.content?.assetId === assetId) || (n.type === "sticker" && n.assetId === assetId));
}

/**
 * The command that sets the artboard background to `next`, as one undo step. A photo picked for the background is
 * added to the asset list first (`photo`). The photo the background showed before is dropped from the list when
 * nothing else uses it, so the document never keeps an unused copy or points at a photo it no longer holds.
 */
export function backgroundCommand(doc: Doc, next: Fill, photo?: AssetRef): Command {
  const previous = doc.artboard.background;
  const commands: Command[] = [];
  if (photo && !Object.hasOwn(doc.assets, photo.id)) commands.push({ type: "asset", id: photo.id, ref: photo });
  commands.push({ type: "artboard", patch: { background: next } });
  const kept = next.type === "image" ? next.assetId : null;
  if (previous.type === "image" && previous.assetId !== kept && Object.hasOwn(doc.assets, previous.assetId) && !shownByLayers(doc, previous.assetId)) {
    commands.push({ type: "asset", id: previous.assetId, ref: null });
  }
  return commands.length === 1 ? commands[0]! : { type: "batch", commands };
}

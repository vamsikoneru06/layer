import { LIMITS, referencedAssetIds, type AssetRef, type Doc, type FrameContent, type FrameNode, type NodeId } from "@vash/schema";
import { applyCommand, type Command } from "./commands";
import { worldBounds } from "./hit-test";
import { createNode, newNodeId } from "./insert";
import { apply, boxCorners, invert, multiply, translation, type Point } from "./math";
import { drawOrder, worldMatrix } from "./scene";

/** Frames close enough in height count as one row when filling photos in reading order. */
const ROW_TOLERANCE = 0.05;

const isFrame = (doc: Doc, id: NodeId): FrameNode | null => {
  const n = doc.nodes[id];
  return n?.type === "frame" && n.lock !== "locked" ? n : null;
};

/** Is `point` (artboard coordinates) inside this frame's shape? */
export function inFrame(doc: Doc, id: NodeId, point: Point): boolean {
  const node = isFrame(doc, id);
  const inverse = node && invert(worldMatrix(doc, id));
  if (!node || !inverse) return false;
  const p = apply(inverse, point);
  const hw = node.width / 2, hh = node.height / 2;
  return node.shape.kind === "ellipse" ? (p.x / hw) ** 2 + (p.y / hh) ** 2 <= 1 : Math.abs(p.x) <= hw && Math.abs(p.y) <= hh;
}

/** The topmost frame that can take a photo under `point` (artboard coordinates), ignoring other layers. */
export function frameAt(doc: Doc, point: Point): NodeId | null {
  const order = drawOrder(doc);
  for (let i = order.length - 1; i >= 0; i--) if (inFrame(doc, order[i]!, point)) return order[i]!;
  return null;
}

/** Frames waiting for a photo (placeholders and empty frames), top to bottom, then left to right. */
export function photoTargets(doc: Doc): NodeId[] {
  const row = doc.artboard.height * ROW_TOLERANCE;
  return drawOrder(doc)
    .filter((id) => {
      const f = isFrame(doc, id);
      return f !== null && (f.placeholder || f.content === null);
    })
    .map((id) => ({ id, box: worldBounds(doc, id)! }))
    .sort((a, b) => (Math.abs(a.box.minY - b.box.minY) > row ? a.box.minY - b.box.minY : a.box.minX - b.box.minX))
    .map((t) => t.id);
}

/** Asset references that `doc` would no longer use once `changes` are applied to frame contents. */
function unused(doc: Doc, changes: Record<NodeId, FrameContent | null>): Command[] {
  const after = referencedAssetIds({ ...doc, nodes: Object.fromEntries(Object.entries(doc.nodes).map(([id, n]) => [id, id in changes && n.type === "frame" ? { ...n, content: changes[id]! } : n])) });
  return Object.keys(doc.assets)
    .filter((id) => !after.has(id))
    .map((id) => ({ type: "asset", id, ref: null }));
}

/** Puts a photo into a frame at "cover" fit, centred. One command, so one undo step. */
export function placePhoto(doc: Doc, frameId: NodeId, asset: AssetRef): Command {
  const content: FrameContent = { assetId: asset.id, offsetX: 0, offsetY: 0, scale: 1 };
  return {
    type: "batch",
    commands: [
      { type: "asset", id: asset.id, ref: asset },
      { type: "update", id: frameId, patch: { content } },
      ...unused(doc, { [frameId]: content }),
    ],
  };
}

/** Empties a frame, dropping the photo's reference if nothing else shows it. */
export function removePhoto(doc: Doc, frameId: NodeId): Command {
  return { type: "batch", commands: [{ type: "update", id: frameId, patch: { content: null } }, ...unused(doc, { [frameId]: null })] };
}

/**
 * The closest position to `c` that still covers the frame: zoom at least 1 ("cover"), and the photo
 * never slid so far that an edge shows.
 */
export function clampContent(frame: { width: number; height: number }, photo: { width: number; height: number }, c: Omit<FrameContent, "assetId">): Omit<FrameContent, "assetId"> {
  const scale = Math.min(LIMITS.scaleMax, Math.max(1, c.scale));
  const fit = Math.max(frame.width / photo.width, frame.height / photo.height) * scale;
  const maxX = Math.max(0, (photo.width * fit - frame.width) / 2);
  const maxY = Math.max(0, (photo.height * fit - frame.height) / 2);
  const clamp = (v: number, m: number) => Math.round(Math.min(m, Math.max(-m, v)) * 100) / 100 || 0;
  return { offsetX: clamp(c.offsetX, maxX), offsetY: clamp(c.offsetY, maxY), scale };
}

/** Zooms and/or moves the photo inside its frame, kept covering it. Null when the frame has no photo. */
export function zoomPhoto(doc: Doc, frameId: NodeId, change: Partial<Omit<FrameContent, "assetId">>): Command | null {
  const node = doc.nodes[frameId];
  if (node?.type !== "frame" || !node.content) return null;
  const asset = doc.assets[node.content.assetId];
  if (!asset) return null;
  const next = clampContent(node, asset, { ...node.content, ...change });
  return { type: "update", id: frameId, patch: { content: { ...node.content, ...next } } };
}

/** A new top-level frame in the photo's proportions (longest side 60% of the design), holding it. */
export function newPhotoFrame(doc: Doc, asset: AssetRef): { command: Command; id: NodeId } {
  const id = newNodeId();
  const base = createNode("frame", doc, id) as FrameNode;
  const side = Math.round(Math.min(doc.artboard.width, doc.artboard.height) * 0.6);
  const k = side / Math.max(asset.width, asset.height);
  const node: FrameNode = {
    ...base,
    name: "Photo",
    width: Math.max(1, Math.round(asset.width * k)),
    height: Math.max(1, Math.round(asset.height * k)),
    placeholder: false,
    content: { assetId: asset.id, offsetX: 0, offsetY: 0, scale: 1 },
  };
  return {
    id,
    command: { type: "batch", commands: [{ type: "asset", id: asset.id, ref: asset }, { type: "insert", nodes: [node], parent: null, index: doc.root.length }] },
  };
}

/**
 * Where a set of photos goes, as one command (one undo step): the first into `target` if given, or a
 * single photo into the one selected frame; the rest fill waiting frames in reading order, and any
 * left over get new frames. Stops at the document's layer and asset limits.
 */
export function fillPhotos(doc: Doc, photos: readonly AssetRef[], o: { target?: NodeId | null; selected?: readonly NodeId[] } = {}): { command: Command; filled: NodeId[] } {
  const commands: Command[] = [];
  const filled: NodeId[] = [];
  let current = doc;
  const run = (cmd: Command) => {
    commands.push(cmd);
    current = applyCommand(current, cmd).doc;
  };
  const selected = o.selected?.length === 1 && isFrame(doc, o.selected[0]!) ? o.selected[0]! : null;
  const first = o.target ?? (photos.length === 1 ? selected : null);
  const queue = photoTargets(doc).filter((id) => id !== first);
  const maxNodes = doc.kind === "template" ? LIMITS.templateNodes : LIMITS.designNodes;

  photos.forEach((photo, i) => {
    if (!(photo.id in current.assets) && Object.keys(current.assets).length >= LIMITS.assets) return;
    const frame = i === 0 && first ? first : queue.shift();
    if (frame) {
      run(placePhoto(current, frame, photo));
      filled.push(frame);
    } else if (Object.keys(current.nodes).length < maxNodes) {
      const added = newPhotoFrame(current, photo);
      run(added.command);
      filled.push(added.id);
    }
  });
  return { command: { type: "batch", commands }, filled };
}

/** Swaps the photos of two frames (either may be empty); each is re-centred at "cover" in its new frame. */
export function swapPhotos(doc: Doc, a: NodeId, b: NodeId): Command | null {
  const fa = isFrame(doc, a);
  const fb = isFrame(doc, b);
  if (!fa || !fb || a === b) return null;
  const moved = (c: FrameContent | null): FrameContent | null => (c ? { assetId: c.assetId, offsetX: 0, offsetY: 0, scale: 1 } : null);
  return {
    type: "batch",
    commands: [
      { type: "update", id: a, patch: { content: moved(fb.content) } },
      { type: "update", id: b, patch: { content: moved(fa.content) } },
    ],
  };
}

/** The corners (artboard coordinates) of a frame's whole photo, including the parts the frame hides. */
export function photoExtent(doc: Doc, id: NodeId): Point[] | null {
  const node = doc.nodes[id];
  if (node?.type !== "frame" || !node.content) return null;
  const asset = doc.assets[node.content.assetId];
  if (!asset) return null;
  const k = Math.max(node.width / asset.width, node.height / asset.height) * node.content.scale;
  return boxCorners(asset.width * k, asset.height * k, multiply(worldMatrix(doc, id), translation(node.content.offsetX, node.content.offsetY)));
}

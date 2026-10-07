import { fillPhotos, type Editor } from "@vash/engine";
import type { AssetMime, AssetRef, NodeId } from "@vash/schema";
import { ApiError, uploadPhoto, type Photo } from "@/lib/api";

/** Drag data for a photo dragged from the Photos panel onto the canvas. */
export const PHOTO_DRAG_TYPE = "application/x-vash-photo";

const MIMES: readonly string[] = ["image/jpeg", "image/png", "image/webp"];

/** The document's record of an uploaded photo, or null while its size isn't known yet. */
export function toAssetRef(p: Photo): AssetRef | null {
  if (!p.width || !p.height || !MIMES.includes(p.mime)) return null;
  return { id: p.id, kind: "photo", mime: p.mime as AssetMime, width: p.width, height: p.height };
}

/** Places photos (see `fillPhotos`) as one undo step and selects the last one placed. */
export function placePhotos(editor: Editor, photos: readonly AssetRef[], target?: NodeId | null): boolean {
  if (photos.length === 0) return false;
  const core = editor.core;
  const { command, filled } = fillPhotos(core.doc, photos, { target, selected: core.getState().selection });
  if (filled.length === 0) {
    core.setChrome({ notice: "This design can't hold any more photos." });
    return false;
  }
  if (!core.dispatch(command)) return false;
  core.select([filled.at(-1)!]);
  return true;
}

/** Uploads files one at a time, reporting progress; returns what uploaded and a message per failure. */
export async function uploadAll(files: readonly File[], onProgress: (done: number, total: number) => void): Promise<{ photos: AssetRef[]; errors: string[] }> {
  const photos: AssetRef[] = [];
  const errors: string[] = [];
  for (const [i, file] of files.entries()) {
    onProgress(i, files.length);
    try {
      const ref = toAssetRef(await uploadPhoto(file));
      if (ref) photos.push(ref);
    } catch (err) {
      errors.push(err instanceof ApiError ? err.message : `${file.name} couldn't be uploaded.`);
    }
  }
  onProgress(files.length, files.length);
  return { photos, errors };
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Reads a photo dragged from the Photos panel. Drag data can come from any page, so it's checked
 * field by field; anything else is ignored.
 */
export function parseDraggedPhoto(data: string): AssetRef | null {
  try {
    const v = JSON.parse(data) as Partial<AssetRef>;
    const size = (n: unknown) => typeof n === "number" && Number.isInteger(n) && n > 0;
    if (typeof v.id !== "string" || !ID.test(v.id) || v.kind !== "photo" || !MIMES.includes(v.mime as string) || !size(v.width) || !size(v.height)) return null;
    return { id: v.id, kind: "photo", mime: v.mime as AssetMime, width: v.width!, height: v.height! };
  } catch {
    return null;
  }
}

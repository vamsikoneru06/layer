import { fillPhotos, type Editor } from "@vash/engine";
import type { AssetMime, AssetRef, NodeId } from "@vash/schema";
import { ApiError, uploadPhoto, type Photo } from "@/lib/api";
import { addLocalPhoto } from "@/lib/local-photos";

/** Fired on window after photos are uploaded, so an open Photos panel can show them. */
export const PHOTOS_UPLOADED = "vash:photos-uploaded";

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

export type UploadResult = {
  photos: AssetRef[];
  /** Why files didn't upload, each reason once (one for the rest once storage is full). */
  errors: string[];
  /** Files that failed for a reason that may pass on a second try (connection, server trouble). */
  retry: File[];
  /** Storage is full: the rest weren't tried, and trying again won't help until photos are deleted. */
  full: boolean;
};

/** A dropped connection, a busy server or a rate limit; not a file the server refused. */
const retryable = (err: unknown) => !(err instanceof ApiError) || err.status === 0 || err.status === 429 || err.status >= 500;
const overQuota = (err: unknown) => err instanceof ApiError && err.status === 422 && typeof err.details.limitBytes === "number";

/**
 * Uploads files one at a time, reporting progress; returns what uploaded and what didn't, and why.
 * With `local` (a design kept in this browser, made without an account) photos stay on the device instead.
 */
export async function uploadAll(files: readonly File[], onProgress: (done: number, total: number) => void, local = false): Promise<UploadResult> {
  const result: UploadResult = { photos: [], errors: [], retry: [], full: false };
  for (const [i, file] of files.entries()) {
    onProgress(i, files.length);
    try {
      const ref = local ? await addLocalPhoto(file) : toAssetRef(await uploadPhoto(file));
      if (ref) result.photos.push(ref);
    } catch (err) {
      // Keeping a photo in this browser failed (storage full, private browsing). Retrying the same file won't help.
      if (local && !(err instanceof ApiError)) {
        result.errors.push("This browser couldn't keep the photos. Check that it has room for them and that site storage is allowed.");
        break;
      }
      if (overQuota(err)) {
        const left = files.length - i;
        result.errors.push(`${(err as Error).message}${left > 1 ? ` ${left} photos weren't uploaded.` : ""}`);
        result.full = true;
        break;
      }
      // A lost connection fails every file with the same words; say it once.
      const message = err instanceof ApiError ? err.message : `${file.name} couldn't be uploaded.`;
      if (!result.errors.includes(message)) result.errors.push(message);
      if (retryable(err)) result.retry.push(file);
    }
  }
  onProgress(files.length, files.length);
  if (result.photos.length) window.dispatchEvent(new Event(PHOTOS_UPLOADED));
  return result;
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

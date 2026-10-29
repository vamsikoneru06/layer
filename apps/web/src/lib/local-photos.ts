import { referencedAssetIds, replaceAssetIds, type AssetMime, type AssetRef, type Doc } from "@vash/schema";
import { preparePhoto } from "./api";
import { PHOTO_STORE, runStore } from "./local-designs";

/**
 * Photos added without an account stay in this browser's IndexedDB, next to the designs that use them,
 * and are referenced by their own ids. Saving a design to an account uploads them (`uploadDocPhotos`).
 */
export interface LocalPhoto {
  id: string;
  blob: Blob;
  mime: AssetMime;
  width: number;
  height: number;
  createdAt: string;
  /** The account asset it was uploaded as, so a save that's retried never uploads it twice. */
  uploadedAs?: string;
}

export interface LocalPhotoStore {
  list(): Promise<LocalPhoto[]>;
  get(id: string): Promise<LocalPhoto | undefined>;
  put(photo: LocalPhoto): Promise<void>;
  delete(id: string): Promise<void>;
}

export const localPhotos: LocalPhotoStore = {
  list: () => runStore(PHOTO_STORE, "readonly", (s) => s.getAll() as IDBRequest<LocalPhoto[]>),
  get: (id) => runStore(PHOTO_STORE, "readonly", (s) => s.get(id) as IDBRequest<LocalPhoto | undefined>),
  put: async (photo) => {
    await runStore(PHOTO_STORE, "readwrite", (s) => s.put(photo));
  },
  delete: async (id) => {
    await runStore(PHOTO_STORE, "readwrite", (s) => s.delete(id));
  },
};

/** The stored file of a device photo, for the image loader; undefined if it isn't on this device. */
export const localPhotoBlob = (id: string): Promise<Blob | undefined> => localPhotos.get(id).then((p) => p?.blob);

export const toLocalRef = (p: LocalPhoto): AssetRef => ({ id: p.id, kind: "photo", mime: p.mime, width: p.width, height: p.height });

/** Checks, resizes like an upload, and keeps a photo on this device. Throws a readable error for unusable files. */
export async function addLocalPhoto(file: File, store: LocalPhotoStore = localPhotos): Promise<AssetRef> {
  const { blob, width, height } = await preparePhoto(file);
  const photo: LocalPhoto = { id: crypto.randomUUID(), blob, mime: blob.type as AssetMime, width, height, createdAt: new Date().toISOString() };
  await store.put(photo);
  return toLocalRef(photo);
}

/** Uploads in progress in this tab, by device photo id, so two saves running at once (a remount, a double click) share one upload. */
const uploading = new Map<string, Promise<string>>();

/** Uploads one device photo and records the account id on it. Re-reads the photo first: another tab may have uploaded it while this one waited. */
async function uploadPhoto(photo: LocalPhoto, store: LocalPhotoStore, upload: (file: File) => Promise<{ id: string }>): Promise<string> {
  const current = (await store.get(photo.id)) ?? photo;
  if (current.uploadedAs) return current.uploadedAs;
  const ext = photo.mime === "image/png" ? "png" : photo.mime === "image/webp" ? "webp" : "jpg";
  const { id: uploadedAs } = await upload(new File([photo.blob], `photo.${ext}`, { type: photo.mime }));
  await store.put({ ...current, uploadedAs });
  return uploadedAs;
}

/**
 * Runs `uploadPhoto` under a Web Lock named for the photo, so two tabs of this browser upload it one after the
 * other. Without Web Locks (old browsers, Node) it runs unlocked, and only the in-tab map above applies.
 */
function uploadPhotoLocked(photo: LocalPhoto, store: LocalPhotoStore, upload: (file: File) => Promise<{ id: string }>): Promise<string> {
  const locks: LockManager | undefined = globalThis.navigator?.locks;
  if (!locks) return uploadPhoto(photo, store, upload);
  return locks.request(`vash-photo-${photo.id}`, () => uploadPhoto(photo, store, upload));
}

/**
 * Uploads the design's photos that are still only on this device and returns the design pointing at the
 * uploaded copies. Each upload is recorded on the device photo first, so running it again after a lost
 * response reuses it. Photos that aren't on the device (account or sample photos) are left as they are.
 */
export async function uploadDocPhotos(doc: Doc, store: LocalPhotoStore, upload: (file: File) => Promise<{ id: string }>): Promise<Doc> {
  const renames = new Map<string, string>();
  for (const id of referencedAssetIds(doc)) {
    const photo = await store.get(id);
    if (!photo) continue;
    if (!photo.uploadedAs) {
      let pending = uploading.get(id);
      if (!pending) {
        pending = uploadPhotoLocked(photo, store, upload).finally(() => uploading.delete(id));
        uploading.set(id, pending);
      }
      photo.uploadedAs = await pending;
    }
    renames.set(id, photo.uploadedAs);
  }
  return renames.size ? replaceAssetIds(doc, renames) : doc;
}

/** Drops uploaded device photos that none of `docs` (the designs still on this device) use any more. */
export async function forgetUnusedPhotos(store: LocalPhotoStore, docs: readonly Doc[]): Promise<void> {
  const used = new Set(docs.flatMap((d) => [...referencedAssetIds(d)]));
  for (const photo of await store.list()) if (photo.uploadedAs && !used.has(photo.id)) await store.delete(photo.id);
}

type Create = (doc: Doc, id?: string) => Promise<{ id: string }>;

/**
 * Wraps "create this design in the account" so the design's device photos are uploaded first and the design
 * refers to the uploaded copies. Safe to call again for the same design: uploads are remembered.
 */
export function withUploadedPhotos(create: Create, upload: (file: File) => Promise<{ id: string }>, store: LocalPhotoStore = localPhotos): Create {
  return async (doc, id) => create(await uploadDocPhotos(doc, store, upload), id);
}

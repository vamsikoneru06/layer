import type { Bucket, ObjectStorage } from "@/server/storage/types";

/** In-memory ObjectStorage. `put` plays the browser's presigned PUT; keys in `failRemove` make `remove` throw. */
export function memoryStorage() {
  const objects = new Map<string, Uint8Array>();
  const failRemove = new Set<string>();
  const id = (bucket: Bucket, key: string) => `${bucket}:${key}`;
  const storage: ObjectStorage = {
    async presignUpload(bucket, key, o) {
      return `https://storage.test/${bucket}/${key}?op=put&type=${encodeURIComponent(o.contentType)}&length=${o.contentLength}&expires=${o.expiresInSeconds}`;
    },
    async presignDownload(bucket, key, expiresInSeconds) {
      return `https://storage.test/${bucket}/${key}?op=get&expires=${expiresInSeconds}`;
    },
    publicUrl: (key) => `https://cdn.test/${key}`,
    async head(bucket, key) {
      const bytes = objects.get(id(bucket, key));
      return bytes ? { contentLength: bytes.byteLength } : null;
    },
    async readPrefix(bucket, key, length) {
      return objects.get(id(bucket, key))?.slice(0, length) ?? new Uint8Array();
    },
    async remove(bucket, key) {
      if (failRemove.has(key)) throw new Error("storage unavailable");
      objects.delete(id(bucket, key));
    },
  };
  return {
    ...storage,
    objects,
    failRemove,
    put: (bucket: Bucket, key: string, bytes: Uint8Array) => void objects.set(id(bucket, key), bytes),
    has: (bucket: Bucket, key: string) => objects.has(id(bucket, key)),
  };
}

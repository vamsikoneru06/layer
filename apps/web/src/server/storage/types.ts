export type Bucket = "private" | "public";

export interface ObjectRef {
  bucket: Bucket;
  key: string;
}

/** Object storage as the app needs it. Keys are always server-generated (see assets/repository.assetKey). */
export interface ObjectStorage {
  presignUpload(bucket: Bucket, key: string, o: { contentType: string; contentLength: number; expiresInSeconds: number }): Promise<string>;
  presignDownload(bucket: Bucket, key: string, expiresInSeconds: number): Promise<string>;
  publicUrl(key: string): string;
  head(bucket: Bucket, key: string): Promise<{ contentLength: number } | null>;
  readPrefix(bucket: Bucket, key: string, length: number): Promise<Uint8Array>;
  /** Server-side copy, within or across buckets, overwriting `to`. */
  copy(from: ObjectRef, to: ObjectRef): Promise<void>;
  /** Idempotent: removing a missing object succeeds. */
  remove(bucket: Bucket, key: string): Promise<void>;
  /** A lower per-user storage allowance, for backends with little room (the built-in database storage). */
  readonly quotaBytes?: number;
}

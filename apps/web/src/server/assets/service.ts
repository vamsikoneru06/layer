import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { isUniqueViolation } from "../db/errors";
import { assets, storageDeletions, user } from "../db/schema";
import type { Db } from "../db/types";
import { conflict, notFound, unprocessable } from "../http/problem";
import { processStorageDeletions } from "../storage/outbox";
import type { ObjectStorage } from "../storage/types";
import {
  findAssetById,
  findResolvableAssets,
  getOwnedAsset,
  insertPendingAsset,
  markAssetReady,
  objectDeletion,
  stagingKey,
  storageUsedBytes,
  type AssetRow,
} from "./repository";
import { bundledUrl, isBundled } from "./bundled";
import { SNIFF_BYTES, sniffImageMime } from "./sniff";

const MB = 1024 * 1024;

/** Spec §9.4. */
export const UPLOAD_LIMITS = {
  maxBytes: 15 * MB,
  storageQuotaBytes: 500 * MB,
  uploadUrlSeconds: 300,
  downloadUrlSeconds: 3600,
  maxDimension: 16_384,
} as const;

/**
 * The staging object is deleted this long after the upload URL is issued: the URL only has to be
 * used before it expires, and a slow upload can keep writing after that.
 */
const STAGING_LINGER_MS = (UPLOAD_LIMITS.uploadUrlSeconds + 3600) * 1000;

export const UPLOAD_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;
export type UploadMime = (typeof UPLOAD_MIMES)[number];

/** The per-user allowance: the spec's 500 MB, or less on a storage backend with little room. */
export const quotaFor = (storage: ObjectStorage) => Math.min(UPLOAD_LIMITS.storageQuotaBytes, storage.quotaBytes ?? Infinity);
export const quotaMessage = (quota: number, action: string) =>
  `${action} would go over your ${Math.round(quota / MB)} MB of storage. Delete some photos to make room.`;

export interface AssetContext {
  db: Db;
  now: () => Date;
  storage: ObjectStorage;
}

export const toAssetJson = (a: AssetRow) => ({
  id: a.id,
  kind: a.kind,
  mime: a.mime,
  bytes: a.bytes,
  width: a.width,
  height: a.height,
  status: a.status,
  visibility: a.visibility,
  createdAt: a.createdAt.toISOString(),
});

/** A client may choose the asset id (a device photo's id) so that a retry after a lost response finds the same asset. */
export interface UploadRequest {
  id?: string;
  kind: "photo" | "thumbnail";
  mime: UploadMime;
  bytes: number;
}

const UPLOAD_ID_TAKEN = "That upload id is already in use.";

/** The row a repeat of a client-chosen id gets back. Only the owner's own request for the same file matches. */
function sameUpload(row: AssetRow, ownerId: string, input: UploadRequest): AssetRow {
  if (row.ownerId !== ownerId) throw conflict(UPLOAD_ID_TAKEN);
  if (row.kind !== input.kind || row.mime !== input.mime || row.bytes !== input.bytes) {
    throw conflict("That upload id was already used for a different file.");
  }
  return row;
}

/**
 * Inserts the pending asset and queues its staging object. With a client-chosen id, a repeat returns the row an
 * earlier identical request made, without checking the quota or queueing anything again.
 */
async function claimUpload(ctx: AssetContext, ownerId: string, input: UploadRequest, now: Date): Promise<{ asset: AssetRow; created: boolean }> {
  try {
    // Lowercase like parseId, so the storage keys match the ones made from ids in paths.
    const id = input.id?.toLowerCase();
    return await ctx.db.transaction(async (tx) => {
      // Same row lock as quotas.ts, so two concurrent requests can't both fit under the quota.
      await tx.select({ id: user.id }).from(user).where(eq(user.id, ownerId)).for("no key update");
      if (id) {
        const existing = await findAssetById(tx, id);
        if (existing) return { asset: sameUpload(existing, ownerId, input), created: false };
      }
      // An id whose object is still queued for deletion can't be reused: that delete would remove the new object.
      if (id && (await tx.select({ id: storageDeletions.id }).from(storageDeletions).where(eq(storageDeletions.assetId, id)).limit(1)).length) {
        throw conflict(UPLOAD_ID_TAKEN);
      }
      const used = await storageUsedBytes(tx, ownerId);
      const quota = quotaFor(ctx.storage);
      if (used + input.bytes > quota) {
        throw unprocessable(quotaMessage(quota, "This upload"), {
          limitBytes: quota,
          usedBytes: used,
        });
      }
      const row = await insertPendingAsset(tx, { id: id ?? randomUUID(), ownerId, kind: input.kind, mime: input.mime, bytes: input.bytes, now });
      // Queued up front, so the staging object is always cleaned up and counts toward the quota once the asset is gone.
      await tx.insert(storageDeletions).values({
        bucket: "private",
        storageKey: stagingKey(ownerId, row.id),
        ownerId,
        assetId: row.id,
        bytes: input.bytes,
        createdAt: now,
        notBefore: new Date(now.getTime() + STAGING_LINGER_MS),
      });
      return { asset: row, created: true };
    });
  } catch (err) {
    // Only a concurrent insert of this id by another owner gets here. Say nothing about whose it is.
    if (input.id && isUniqueViolation(err)) throw conflict(UPLOAD_ID_TAKEN);
    throw err;
  }
}

export async function requestUpload(ctx: AssetContext, ownerId: string, input: UploadRequest) {
  const now = ctx.now();
  const { asset, created } = await claimUpload(ctx, ownerId, input, now);
  // A ready asset needs no bytes. A pending one (a repeat of an unfinished upload) gets a fresh URL for its staging key.
  if (asset.status === "ready") return { asset, upload: null, created };
  const url = await ctx.storage.presignUpload("private", stagingKey(ownerId, asset.id), {
    contentType: input.mime,
    contentLength: input.bytes,
    expiresInSeconds: UPLOAD_LIMITS.uploadUrlSeconds,
  });
  return {
    asset,
    created,
    upload: {
      url,
      method: "PUT" as const,
      headers: { "content-type": input.mime },
      expiresAt: new Date(now.getTime() + UPLOAD_LIMITS.uploadUrlSeconds * 1000).toISOString(),
    },
  };
}

/**
 * Deletes the row and queues its object. Run it inside the caller's transaction, then call
 * flushAssetDeletion once that transaction has committed.
 */
export async function queueAssetDeletion(db: Db, asset: AssetRow, now: Date): Promise<void> {
  await db.delete(assets).where(eq(assets.id, asset.id));
  await db.insert(storageDeletions).values(objectDeletion(asset, now));
}

/**
 * Removes whatever of this asset is already due. Anything storage refuses, and a staging object whose
 * URL may still be live, is left for the cron. Call it outside any transaction.
 */
export async function flushAssetDeletion(ctx: AssetContext, assetId: string, now: Date): Promise<void> {
  await processStorageDeletions(ctx.db, ctx.storage, now, { assetId });
}

/** Deletes the row and queues its object in one transaction, then removes whatever of this asset is already due. */
export async function discardAsset(ctx: AssetContext, asset: AssetRow): Promise<void> {
  const now = ctx.now();
  await ctx.db.transaction((tx) => queueAssetDeletion(tx, asset, now));
  await flushAssetDeletion(ctx, asset.id, now);
}

export async function completeUpload(ctx: AssetContext, ownerId: string, id: string, dims: { width: number; height: number }): Promise<AssetRow> {
  const asset = await getOwnedAsset(ctx.db, ownerId, id);
  if (!asset) throw notFound();
  if (asset.status === "ready") return asset;

  const staged = await ctx.storage.head("private", stagingKey(ownerId, id));
  if (!staged) throw conflict("The file hasn't been uploaded yet. Upload it with the URL you were given, then try again.");
  const sizeMismatch = "The uploaded file's size doesn't match what was declared. Start the upload again.";
  if (staged.contentLength !== asset.bytes) {
    await discardAsset(ctx, asset);
    throw unprocessable(sizeMismatch);
  }

  // Check a copy the browser can't write to: the upload URL stays valid for a few minutes and
  // could replace the staging object after any check made on it.
  await ctx.storage.copy({ bucket: "private", key: stagingKey(ownerId, id) }, { bucket: "private", key: asset.storageKey });
  const head = await ctx.storage.head("private", asset.storageKey);
  if (head?.contentLength !== asset.bytes) {
    await discardAsset(ctx, asset);
    throw unprocessable(sizeMismatch);
  }
  const sniffed = sniffImageMime(await ctx.storage.readPrefix("private", asset.storageKey, SNIFF_BYTES));
  if (sniffed !== asset.mime) {
    await discardAsset(ctx, asset);
    throw unprocessable("That file isn't the JPEG, PNG or WebP image it claimed to be.");
  }
  const ready = await markAssetReady(ctx.db, ownerId, id, dims, ctx.now());
  if (ready) return ready;
  // A concurrent complete may have won the update; the asset is ready either way.
  const current = await getOwnedAsset(ctx.db, ownerId, id);
  if (current) return current;
  // Deleted while we copied: nothing else would remove the copy.
  await discardAsset(ctx, asset);
  throw notFound();
}

/**
 * Short-lived URLs for the assets the viewer may see. Bundled assets (sample photos) resolve to the
 * site's own files and need no storage; without storage, other assets are left out.
 */
export async function resolveAssets(
  ctx: Omit<AssetContext, "storage"> & { storage: ObjectStorage | null },
  viewerId: string | null,
  ids: string[],
  opts: { admin?: boolean } = {},
) {
  const rows = await findResolvableAssets(ctx.db, viewerId, [...new Set(ids)], opts);
  const expiresAt = new Date(ctx.now().getTime() + UPLOAD_LIMITS.downloadUrlSeconds * 1000).toISOString();
  const { storage } = ctx;
  const resolved = await Promise.all(
    rows.map(async (a) => {
      if (isBundled(a.storageKey)) return { id: a.id, url: bundledUrl(a.storageKey), expiresAt: null };
      if (!storage) return null;
      return a.visibility === "public"
        ? { id: a.id, url: storage.publicUrl(a.storageKey), expiresAt: null }
        : { id: a.id, url: await storage.presignDownload("private", a.storageKey, UPLOAD_LIMITS.downloadUrlSeconds), expiresAt };
    }),
  );
  return resolved.filter((r) => r !== null);
}

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { assets, storageDeletions, user } from "../db/schema";
import type { Db } from "../db/types";
import { conflict, notFound, unprocessable } from "../http/problem";
import { processStorageDeletions } from "../storage/outbox";
import type { ObjectStorage } from "../storage/types";
import {
  findResolvableAssets,
  getOwnedAsset,
  insertPendingAsset,
  markAssetReady,
  objectDeletion,
  stagingKey,
  storageUsedBytes,
  type AssetRow,
} from "./repository";
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

export async function requestUpload(ctx: AssetContext, ownerId: string, input: { kind: "photo" | "thumbnail"; mime: UploadMime; bytes: number }) {
  const now = ctx.now();
  const asset = await ctx.db.transaction(async (tx) => {
    // Same row lock as quotas.ts, so two concurrent requests can't both fit under the quota.
    await tx.select({ id: user.id }).from(user).where(eq(user.id, ownerId)).for("no key update");
    const used = await storageUsedBytes(tx, ownerId);
    if (used + input.bytes > UPLOAD_LIMITS.storageQuotaBytes) {
      throw unprocessable("This upload would go over your 500 MB of storage. Delete some photos to make room.", {
        limitBytes: UPLOAD_LIMITS.storageQuotaBytes,
        usedBytes: used,
      });
    }
    const row = await insertPendingAsset(tx, { id: randomUUID(), ownerId, kind: input.kind, mime: input.mime, bytes: input.bytes, now });
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
    return row;
  });
  const url = await ctx.storage.presignUpload("private", stagingKey(ownerId, asset.id), {
    contentType: input.mime,
    contentLength: input.bytes,
    expiresInSeconds: UPLOAD_LIMITS.uploadUrlSeconds,
  });
  return {
    asset,
    upload: {
      url,
      method: "PUT" as const,
      headers: { "content-type": input.mime },
      expiresAt: new Date(now.getTime() + UPLOAD_LIMITS.uploadUrlSeconds * 1000).toISOString(),
    },
  };
}

/**
 * Deletes the row and queues its object in one transaction, then removes whatever of this asset is
 * already due. Anything storage refuses, and a staging object whose URL may still be live, is left
 * for the cron.
 */
export async function discardAsset(ctx: AssetContext, asset: AssetRow): Promise<void> {
  const now = ctx.now();
  await ctx.db.transaction(async (tx) => {
    await tx.delete(assets).where(eq(assets.id, asset.id));
    await tx.insert(storageDeletions).values(objectDeletion(asset, now));
  });
  await processStorageDeletions(ctx.db, ctx.storage, now, { assetId: asset.id });
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
  await ctx.storage.copy("private", stagingKey(ownerId, id), asset.storageKey);
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

export async function resolveAssets(ctx: AssetContext, viewerId: string | null, ids: string[]) {
  const rows = await findResolvableAssets(ctx.db, viewerId, [...new Set(ids)]);
  const expiresAt = new Date(ctx.now().getTime() + UPLOAD_LIMITS.downloadUrlSeconds * 1000).toISOString();
  return Promise.all(
    rows.map(async (a) =>
      a.visibility === "public"
        ? { id: a.id, url: ctx.storage.publicUrl(a.storageKey), expiresAt: null }
        : { id: a.id, url: await ctx.storage.presignDownload("private", a.storageKey, UPLOAD_LIMITS.downloadUrlSeconds), expiresAt },
    ),
  );
}

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { assets, storageDeletions, user } from "../db/schema";
import type { Db } from "../db/types";
import { conflict, notFound, unprocessable } from "../http/problem";
import type { ObjectStorage } from "../storage/types";
import { getOwnedAsset, insertPendingAsset, markAssetReady, storageUsedBytes, type AssetRow } from "./repository";
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
    return insertPendingAsset(tx, { id: randomUUID(), ownerId, kind: input.kind, mime: input.mime, bytes: input.bytes, now });
  });
  const url = await ctx.storage.presignUpload("private", asset.storageKey, {
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

/** Removes the row now; removes the object now, or queues it if storage is unavailable. */
export async function discardAsset(ctx: AssetContext, asset: AssetRow): Promise<void> {
  await ctx.db.delete(assets).where(eq(assets.id, asset.id));
  try {
    await ctx.storage.remove(asset.visibility, asset.storageKey);
  } catch {
    await ctx.db.insert(storageDeletions).values({ bucket: asset.visibility, storageKey: asset.storageKey, createdAt: ctx.now() });
  }
}

export async function completeUpload(ctx: AssetContext, ownerId: string, id: string, dims: { width: number; height: number }): Promise<AssetRow> {
  const asset = await getOwnedAsset(ctx.db, ownerId, id);
  if (!asset) throw notFound();
  if (asset.status === "ready") return asset;

  const head = await ctx.storage.head("private", asset.storageKey);
  if (!head) throw conflict("The file hasn't been uploaded yet. Upload it with the URL you were given, then try again.");

  if (head.contentLength !== asset.bytes) {
    await discardAsset(ctx, asset);
    throw unprocessable("The uploaded file's size doesn't match what was declared. Start the upload again.");
  }
  const sniffed = sniffImageMime(await ctx.storage.readPrefix("private", asset.storageKey, SNIFF_BYTES));
  if (sniffed !== asset.mime) {
    await discardAsset(ctx, asset);
    throw unprocessable("That file isn't the JPEG, PNG or WebP image it claimed to be.");
  }
  const ready = await markAssetReady(ctx.db, ownerId, id, dims, ctx.now());
  // A concurrent complete may have won the update; the asset is ready either way.
  return ready ?? (await getOwnedAsset(ctx.db, ownerId, id)) ?? asset;
}

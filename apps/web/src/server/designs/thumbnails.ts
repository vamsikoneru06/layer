import { and, eq, ne, sql } from "drizzle-orm";
import { getOwnedAsset, type AssetRow } from "../assets/repository";
import { flushAssetDeletion, queueAssetDeletion, type AssetContext } from "../assets/service";
import { designs, templateVersions } from "../db/schema";
import type { Db } from "../db/types";
import { notFound, unprocessable } from "../http/problem";

const owned = (ownerId: string, id: string) => and(eq(designs.id, id), eq(designs.ownerId, ownerId));

/**
 * Inside the caller's transaction: queues a thumbnail's removal unless another design or a template still
 * shows it ("duplicate" shares it). Returns the asset when it was queued, so the caller can flush it after commit.
 */
async function queueIfUnused(tx: Db, ownerId: string, assetId: string, exceptDesign: string, now: Date): Promise<AssetRow | undefined> {
  const count = sql<number>`count(*)::int`;
  const [inDesigns] = await tx.select({ n: count }).from(designs).where(and(eq(designs.thumbnailAssetId, assetId), ne(designs.id, exceptDesign)));
  const [inTemplates] = await tx.select({ n: count }).from(templateVersions).where(eq(templateVersions.thumbnailAssetId, assetId));
  if ((inDesigns?.n ?? 0) + (inTemplates?.n ?? 0) > 0) return undefined;
  const asset = await getOwnedAsset(tx, ownerId, assetId);
  if (asset) await queueAssetDeletion(tx, asset, now);
  return asset;
}

/**
 * Points a design at a freshly uploaded thumbnail and removes the one it replaces. Doesn't touch
 * `updatedAt`: a new preview isn't an edit, so it mustn't reorder the design list.
 */
export async function setDesignThumbnail(ctx: AssetContext, ownerId: string, designId: string, assetId: string): Promise<void> {
  const asset = await getOwnedAsset(ctx.db, ownerId, assetId);
  if (asset?.kind !== "thumbnail" || asset.status !== "ready") throw unprocessable("assetId must be one of your uploaded thumbnails.");
  const now = ctx.now();
  const replaced = await ctx.db.transaction(async (tx) => {
    // Locks the design, so two replacements (or a duplicate, see service.ts) run one after the other.
    const [before] = await tx.select({ thumbnailAssetId: designs.thumbnailAssetId }).from(designs).where(owned(ownerId, designId)).for("no key update");
    if (!before) throw notFound();
    await tx.update(designs).set({ thumbnailAssetId: assetId }).where(owned(ownerId, designId));
    if (!before.thumbnailAssetId || before.thumbnailAssetId === assetId) return undefined;
    return queueIfUnused(tx, ownerId, before.thumbnailAssetId, designId, now);
  });
  if (replaced) await flushAssetDeletion(ctx, replaced.id, now);
}

/** Deletes a design and, if nothing else shows it, its thumbnail. False if there was no such design. */
export async function deleteDesignAndThumbnail(ctx: AssetContext, ownerId: string, designId: string): Promise<boolean> {
  const now = ctx.now();
  const removed = await ctx.db.transaction(async (tx) => {
    const [gone] = await tx.delete(designs).where(owned(ownerId, designId)).returning({ thumbnailAssetId: designs.thumbnailAssetId });
    if (!gone) return null;
    const thumbnail = gone.thumbnailAssetId ? await queueIfUnused(tx, ownerId, gone.thumbnailAssetId, designId, now) : undefined;
    return { thumbnail };
  });
  if (!removed) return false;
  if (removed.thumbnail) await flushAssetDeletion(ctx, removed.thumbnail.id, now);
  return true;
}

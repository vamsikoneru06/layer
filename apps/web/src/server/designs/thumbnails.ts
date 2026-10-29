import { and, eq, ne, sql } from "drizzle-orm";
import { getOwnedAsset } from "../assets/repository";
import { discardAsset, type AssetContext } from "../assets/service";
import { designs, templateVersions } from "../db/schema";
import { notFound, unprocessable } from "../http/problem";

const owned = (ownerId: string, id: string) => and(eq(designs.id, id), eq(designs.ownerId, ownerId));

/** Deletes a thumbnail asset unless another design or a template still shows it ("duplicate" shares it). */
async function discardIfUnused(ctx: AssetContext, ownerId: string, assetId: string, exceptDesign: string): Promise<void> {
  const count = sql<number>`count(*)::int`;
  const [inDesigns] = await ctx.db.select({ n: count }).from(designs).where(and(eq(designs.thumbnailAssetId, assetId), ne(designs.id, exceptDesign)));
  const [inTemplates] = await ctx.db.select({ n: count }).from(templateVersions).where(eq(templateVersions.thumbnailAssetId, assetId));
  if ((inDesigns?.n ?? 0) + (inTemplates?.n ?? 0) > 0) return;
  const asset = await getOwnedAsset(ctx.db, ownerId, assetId);
  if (asset) await discardAsset(ctx, asset);
}

/**
 * Points a design at a freshly uploaded thumbnail and removes the one it replaces. Doesn't touch
 * `updatedAt`: a new preview isn't an edit, so it mustn't reorder the design list.
 */
export async function setDesignThumbnail(ctx: AssetContext, ownerId: string, designId: string, assetId: string): Promise<void> {
  const asset = await getOwnedAsset(ctx.db, ownerId, assetId);
  if (asset?.kind !== "thumbnail" || asset.status !== "ready") throw unprocessable("assetId must be one of your uploaded thumbnails.");
  const [before] = await ctx.db.select({ thumbnailAssetId: designs.thumbnailAssetId }).from(designs).where(owned(ownerId, designId));
  if (!before) throw notFound();
  await ctx.db.update(designs).set({ thumbnailAssetId: assetId }).where(owned(ownerId, designId));
  if (before.thumbnailAssetId && before.thumbnailAssetId !== assetId) await discardIfUnused(ctx, ownerId, before.thumbnailAssetId, designId);
}

/** Deletes a design and, if nothing else shows it, its thumbnail. False if there was no such design. */
export async function deleteDesignAndThumbnail(ctx: AssetContext, ownerId: string, designId: string): Promise<boolean> {
  const [gone] = await ctx.db.delete(designs).where(owned(ownerId, designId)).returning({ thumbnailAssetId: designs.thumbnailAssetId });
  if (!gone) return false;
  if (gone.thumbnailAssetId) await discardIfUnused(ctx, ownerId, gone.thumbnailAssetId, designId);
  return true;
}


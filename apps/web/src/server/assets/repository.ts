import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { assets } from "../db/schema";
import type { Db } from "../db/types";
import type { Cursor } from "../http/cursor";
import { isUuid } from "../http/ids";

/**
 * Returns the ids from `refs` the owner may NOT place in a document: anything that isn't a ready
 * asset of the claimed kind that the owner owns, the system owns, or that is public.
 */
export async function findUnusableAssets(db: Db, ownerId: string, refs: { id: string; kind: "photo" | "sticker" }[]): Promise<string[]> {
  const candidates = refs.map((r) => r.id).filter(isUuid).map((id) => id.toLowerCase());
  const rows =
    candidates.length === 0
      ? []
      : await db
          .select({ id: assets.id, kind: assets.kind })
          .from(assets)
          .where(
            and(
              inArray(assets.id, candidates),
              eq(assets.status, "ready"),
              or(eq(assets.ownerId, ownerId), isNull(assets.ownerId), eq(assets.visibility, "public")),
            ),
          );
  const usable = new Map(rows.map((r) => [r.id, r.kind]));
  return refs.filter((r) => usable.get(r.id.toLowerCase()) !== r.kind).map((r) => r.id);
}

export type AssetRow = typeof assets.$inferSelect;

export const assetKey = (ownerId: string, assetId: string) => `u/${ownerId}/${assetId}`;

export async function insertPendingAsset(
  db: Db,
  v: { id: string; ownerId: string; kind: "photo" | "thumbnail"; mime: AssetRow["mime"]; bytes: number; now: Date },
): Promise<AssetRow> {
  const [row] = await db
    .insert(assets)
    .values({ id: v.id, ownerId: v.ownerId, kind: v.kind, mime: v.mime, bytes: v.bytes, storageKey: assetKey(v.ownerId, v.id), createdAt: v.now, updatedAt: v.now })
    .returning();
  return row!;
}

export async function getOwnedAsset(db: Db, ownerId: string, id: string): Promise<AssetRow | undefined> {
  const [row] = await db.select().from(assets).where(and(eq(assets.id, id), eq(assets.ownerId, ownerId)));
  return row;
}

export async function markAssetReady(db: Db, ownerId: string, id: string, dims: { width: number; height: number }, now: Date): Promise<AssetRow | undefined> {
  const [row] = await db
    .update(assets)
    .set({ status: "ready", width: dims.width, height: dims.height, updatedAt: now })
    .where(and(eq(assets.id, id), eq(assets.ownerId, ownerId), eq(assets.status, "pending")))
    .returning();
  return row;
}

/** Bytes counted against the quota: pending uploads included, so a burst of requests can't overshoot it. */
export async function storageUsedBytes(db: Db, ownerId: string): Promise<number> {
  const [row] = await db.select({ used: sql<string>`coalesce(sum(${assets.bytes}), 0)` }).from(assets).where(eq(assets.ownerId, ownerId));
  return Number(row?.used ?? 0);
}

export function listReadyAssets(db: Db, ownerId: string, q: { kind?: AssetRow["kind"]; cursor?: Cursor; limit: number }): Promise<AssetRow[]> {
  return db
    .select()
    .from(assets)
    .where(
      and(
        eq(assets.ownerId, ownerId),
        eq(assets.status, "ready"),
        q.kind ? eq(assets.kind, q.kind) : undefined,
        q.cursor ? sql`(${assets.createdAt}, ${assets.id}) < (${q.cursor.at}::timestamptz, ${q.cursor.id}::uuid)` : undefined,
      ),
    )
    .orderBy(desc(assets.createdAt), desc(assets.id))
    .limit(q.limit + 1);
}

/** Ready assets the viewer may see: their own, system-owned, or public. Guests (null) see only the latter two. */
export function findResolvableAssets(db: Db, viewerId: string | null, ids: string[]): Promise<AssetRow[]> {
  return db
    .select()
    .from(assets)
    .where(
      and(
        inArray(assets.id, ids),
        eq(assets.status, "ready"),
        or(isNull(assets.ownerId), eq(assets.visibility, "public"), viewerId ? eq(assets.ownerId, viewerId) : undefined),
      ),
    );
}

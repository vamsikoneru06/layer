import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { assets, storageDeletions, templates } from "../db/schema";
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
/** Where the browser uploads. Only the server writes assetKey, by copying from here once the bytes are checked. */
export const stagingKey = (ownerId: string, assetId: string) => `staging/${ownerId}/${assetId}`;

/** Outbox row for an asset's object. Owner and size ride along so the bytes keep counting toward the quota until it's gone. */
export const objectDeletion = (a: Pick<AssetRow, "id" | "ownerId" | "visibility" | "storageKey" | "bytes">, now: Date) => ({
  bucket: a.visibility,
  storageKey: a.storageKey,
  ownerId: a.ownerId,
  assetId: a.id,
  bytes: a.bytes,
  createdAt: now,
  notBefore: now,
});

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

/**
 * Bytes counted against the quota: every asset row (pending included, so a burst of requests can't
 * overshoot it), plus queued deletions whose asset is gone but whose object may still exist: a
 * staging object an unexpired upload URL can still write, or a removal storage refused), and the
 * public copies of every template the owner published.
 */
export async function storageUsedBytes(db: Db, ownerId: string): Promise<number> {
  const [row] = await db.select({ used: sql<string>`coalesce(sum(${assets.bytes}), 0)` }).from(assets).where(eq(assets.ownerId, ownerId));
  const [queued] = await db
    .select({ used: sql<string>`coalesce(sum(${storageDeletions.bytes}), 0)` })
    .from(storageDeletions)
    .where(and(eq(storageDeletions.ownerId, ownerId), sql`not exists (select 1 from ${assets} where ${assets.id} = ${storageDeletions.assetId})`));
  const [published] = await db
    .select({ used: sql<string>`coalesce(sum(${assets.bytes}), 0)` })
    .from(assets)
    .innerJoin(templates, eq(templates.id, assets.templateId))
    .where(eq(templates.authorId, ownerId));
  return Number(row?.used ?? 0) + Number(queued?.used ?? 0) + Number(published?.used ?? 0);
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

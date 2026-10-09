import { and, desc, eq, notInArray, sql } from "drizzle-orm";
import type { Doc } from "@vash/schema";
import { designs, designVersions } from "../db/schema";
import type { Db } from "../db/types";
import type { Cursor } from "../http/cursor";

export type DesignRow = typeof designs.$inferSelect;
export type DesignSummary = Omit<DesignRow, "doc" | "ownerId" | "sourceTemplateId" | "sourceTemplateVersion"> & {
  format: string;
  width: number;
  height: number;
};

// Cards need the format and aspect ratio, but lists must not ship whole documents.
const summaryColumns = {
  id: designs.id,
  title: designs.title,
  folderId: designs.folderId,
  thumbnailAssetId: designs.thumbnailAssetId,
  version: designs.version,
  createdAt: designs.createdAt,
  updatedAt: designs.updatedAt,
  format: sql<string>`${designs.doc}->'meta'->>'format'`,
  width: sql<number>`(${designs.doc}->'artboard'->>'width')::int`,
  height: sql<number>`(${designs.doc}->'artboard'->>'height')::int`,
};

const owned = (ownerId: string, id: string) => and(eq(designs.id, id), eq(designs.ownerId, ownerId));

export function listDesigns(db: Db, ownerId: string, q: { folderId?: string; cursor?: Cursor; limit: number }): Promise<DesignSummary[]> {
  return db
    .select(summaryColumns)
    .from(designs)
    .where(
      and(
        eq(designs.ownerId, ownerId),
        q.folderId ? eq(designs.folderId, q.folderId) : undefined,
        q.cursor ? sql`(${designs.updatedAt}, ${designs.id}) < (${q.cursor.at}::timestamptz, ${q.cursor.id}::uuid)` : undefined,
      ),
    )
    .orderBy(desc(designs.updatedAt), desc(designs.id))
    .limit(q.limit + 1);
}

export async function getDesign(db: Db, ownerId: string, id: string): Promise<DesignRow | undefined> {
  const [row] = await db.select().from(designs).where(owned(ownerId, id));
  return row;
}

export async function getDesignVersion(db: Db, ownerId: string, id: string): Promise<number | undefined> {
  const [row] = await db.select({ version: designs.version }).from(designs).where(owned(ownerId, id));
  return row?.version;
}

/** Reads the design and locks its row until the transaction ends, so concurrent saves and restores queue up. */
export async function getDesignForUpdate(db: Db, ownerId: string, id: string): Promise<DesignRow | undefined> {
  const [row] = await db.select().from(designs).where(owned(ownerId, id)).for("update");
  return row;
}

export async function insertDesign(db: Db, values: typeof designs.$inferInsert): Promise<DesignRow> {
  const [row] = await db.insert(designs).values(values).returning();
  return row!;
}

/** Compare-and-swap on `version`: the WHERE clause makes concurrent saves of one version mutually exclusive. */
export async function updateDesignDoc(db: Db, ownerId: string, id: string, expectedVersion: number, doc: Doc, now: Date): Promise<DesignRow | undefined> {
  const [row] = await db
    .update(designs)
    .set({ doc, title: doc.meta.title, version: sql`${designs.version} + 1`, updatedAt: now })
    .where(and(owned(ownerId, id), eq(designs.version, expectedVersion)))
    .returning();
  return row;
}

export async function updateDesignMeta(
  db: Db,
  ownerId: string,
  id: string,
  patch: { title?: string; folderId?: string | null },
  now: Date,
): Promise<DesignRow | undefined> {
  const [row] = await db
    .update(designs)
    .set({
      updatedAt: now,
      ...(patch.folderId !== undefined ? { folderId: patch.folderId } : {}),
      ...(patch.title !== undefined
        ? {
            title: patch.title,
            doc: sql`jsonb_set(${designs.doc}, '{meta,title}', to_jsonb(${patch.title}::text))`,
            version: sql`${designs.version} + 1`,
          }
        : {}),
    })
    .where(owned(ownerId, id))
    .returning();
  return row;
}

export async function deleteDesign(db: Db, ownerId: string, id: string): Promise<boolean> {
  return (await db.delete(designs).where(owned(ownerId, id)).returning({ id: designs.id })).length > 0;
}

export type VersionRow = typeof designVersions.$inferSelect;

/** Newest first. Snapshots of one design are ordered by time, then by version (versions only ever grow). */
const newestFirst = [desc(designVersions.createdAt), desc(designVersions.version)];

export async function latestVersionAt(db: Db, ownerId: string, designId: string): Promise<Date | undefined> {
  const [row] = await db
    .select({ createdAt: designVersions.createdAt })
    .from(designVersions)
    .where(and(eq(designVersions.designId, designId), eq(designVersions.ownerId, ownerId)))
    .orderBy(...newestFirst)
    .limit(1);
  return row?.createdAt;
}

export async function insertVersion(db: Db, values: typeof designVersions.$inferInsert): Promise<void> {
  await db.insert(designVersions).values(values);
}

/** Keeps the newest `keep` versions of a design and deletes the rest. */
export async function pruneVersions(db: Db, ownerId: string, designId: string, keep: number): Promise<void> {
  const scope = and(eq(designVersions.designId, designId), eq(designVersions.ownerId, ownerId));
  const newest = db.select({ id: designVersions.id }).from(designVersions).where(scope).orderBy(...newestFirst).limit(keep);
  await db.delete(designVersions).where(and(scope, notInArray(designVersions.id, newest)));
}

export async function listVersionRows(db: Db, ownerId: string, designId: string): Promise<Pick<VersionRow, "id" | "version" | "title" | "createdAt">[]> {
  return db
    .select({ id: designVersions.id, version: designVersions.version, title: designVersions.title, createdAt: designVersions.createdAt })
    .from(designVersions)
    .where(and(eq(designVersions.designId, designId), eq(designVersions.ownerId, ownerId)))
    .orderBy(...newestFirst);
}

export async function getVersionRow(db: Db, ownerId: string, designId: string, versionId: string): Promise<VersionRow | undefined> {
  const [row] = await db
    .select()
    .from(designVersions)
    .where(and(eq(designVersions.id, versionId), eq(designVersions.designId, designId), eq(designVersions.ownerId, ownerId)));
  return row;
}

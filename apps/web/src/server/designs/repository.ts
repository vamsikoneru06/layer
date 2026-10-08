import { and, desc, eq, getTableColumns, sql } from "drizzle-orm";
import type { Doc } from "@vash/schema";
import { designs } from "../db/schema";
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
  // Stored generated columns (migration 0007): reading them never loads the document itself.
  format: sql<string>`${designs.format}`,
  width: sql<number>`${designs.width}`,
  height: sql<number>`${designs.height}`,
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

/** Every column but the document: writes hand the document back from memory instead of reading it from Postgres. */
const { doc: _doc, ...withoutDoc } = getTableColumns(designs);

export async function insertDesign(db: Db, values: typeof designs.$inferInsert): Promise<DesignRow> {
  const [row] = await db.insert(designs).values(values).returning(withoutDoc);
  return { ...row!, doc: values.doc };
}

/**
 * Compare-and-swap on `version`: the WHERE clause makes concurrent saves of one version mutually exclusive.
 * Returns everything but the document, which the caller already has (it can be hundreds of KB).
 */
export async function updateDesignDoc(db: Db, ownerId: string, id: string, expectedVersion: number, doc: Doc, now: Date): Promise<Omit<DesignRow, "doc"> | undefined> {
  const [row] = await db
    .update(designs)
    .set({ doc, title: doc.meta.title, version: sql`${designs.version} + 1`, updatedAt: now })
    .where(and(owned(ownerId, id), eq(designs.version, expectedVersion)))
    .returning(withoutDoc);
  return row;
}

export async function updateDesignMeta(
  db: Db,
  ownerId: string,
  id: string,
  patch: { title?: string; folderId?: string | null },
  now: Date,
  opts: { withDoc: boolean } = { withDoc: true },
): Promise<(Omit<DesignRow, "doc"> & { doc?: Doc }) | undefined> {
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
    .returning(opts.withDoc ? getTableColumns(designs) : withoutDoc);
  return row;
}

export async function deleteDesign(db: Db, ownerId: string, id: string): Promise<boolean> {
  return (await db.delete(designs).where(owned(ownerId, id)).returning({ id: designs.id })).length > 0;
}

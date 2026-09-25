import { and, asc, eq, sql } from "drizzle-orm";
import { folders } from "../db/schema";
import type { Db } from "../db/types";
import type { Cursor } from "../http/cursor";

export type FolderRow = typeof folders.$inferSelect;

export function listFolders(db: Db, ownerId: string, page: { cursor?: Cursor; limit: number }): Promise<FolderRow[]> {
  return db
    .select()
    .from(folders)
    .where(
      and(
        eq(folders.ownerId, ownerId),
        page.cursor ? sql`(${folders.createdAt}, ${folders.id}) > (${page.cursor.at}::timestamptz, ${page.cursor.id}::uuid)` : undefined,
      ),
    )
    .orderBy(asc(folders.createdAt), asc(folders.id))
    .limit(page.limit + 1);
}

export async function createFolder(db: Db, ownerId: string, name: string, now: Date): Promise<FolderRow> {
  const [row] = await db.insert(folders).values({ ownerId, name, createdAt: now, updatedAt: now }).returning();
  return row!;
}

export async function renameFolder(db: Db, ownerId: string, id: string, name: string, now: Date): Promise<FolderRow | undefined> {
  const [row] = await db
    .update(folders)
    .set({ name, updatedAt: now })
    .where(and(eq(folders.id, id), eq(folders.ownerId, ownerId)))
    .returning();
  return row;
}

export async function deleteFolder(db: Db, ownerId: string, id: string): Promise<boolean> {
  const rows = await db.delete(folders).where(and(eq(folders.id, id), eq(folders.ownerId, ownerId))).returning({ id: folders.id });
  return rows.length > 0;
}

export async function folderExists(db: Db, ownerId: string, id: string): Promise<boolean> {
  const rows = await db.select({ id: folders.id }).from(folders).where(and(eq(folders.id, id), eq(folders.ownerId, ownerId)));
  return rows.length > 0;
}

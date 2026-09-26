import { asc, eq, lt, sql } from "drizzle-orm";
import { storageDeletions } from "../db/schema";
import type { Db } from "../db/types";
import type { ObjectStorage } from "./types";

export const OUTBOX = { batchSize: 50, maxAttempts: 5 } as const;

/**
 * Deletes queued objects, oldest first. Removal is idempotent, so overlapping runs are harmless.
 * Rows that keep failing stop being retried after OUTBOX.maxAttempts and stay for inspection.
 */
export async function processStorageDeletions(db: Db, storage: ObjectStorage, batchSize: number = OUTBOX.batchSize) {
  const rows = await db
    .select()
    .from(storageDeletions)
    .where(lt(storageDeletions.attempts, OUTBOX.maxAttempts))
    .orderBy(asc(storageDeletions.createdAt), asc(storageDeletions.id))
    .limit(batchSize);
  let deleted = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      await storage.remove(row.bucket, row.storageKey);
      await db.delete(storageDeletions).where(eq(storageDeletions.id, row.id));
      deleted++;
    } catch {
      await db.update(storageDeletions).set({ attempts: sql`${storageDeletions.attempts} + 1` }).where(eq(storageDeletions.id, row.id));
      failed++;
    }
  }
  return { deleted, failed };
}

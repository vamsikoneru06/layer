import { and, asc, eq, lt, lte, sql } from "drizzle-orm";
import { storageDeletions } from "../db/schema";
import type { Db } from "../db/types";
import type { ObjectStorage } from "./types";

/** drainBudgetMs keeps one cron run well inside a serverless function's time limit. */
export const OUTBOX = { batchSize: 50, maxAttempts: 5, drainBudgetMs: 20_000 } as const;

interface Position {
  createdAt: Date;
  id: string;
}

/**
 * Deletes one batch of due objects (not_before <= now), oldest first, after `after` if given
 * and only for `assetId` if given.
 * Removal is idempotent, so overlapping runs are harmless. Rows that keep failing stop being
 * retried after OUTBOX.maxAttempts and stay for inspection.
 */
export async function processStorageDeletions(
  db: Db,
  storage: ObjectStorage,
  now: Date,
  opts: { batchSize?: number; after?: Position; assetId?: string } = {},
): Promise<{ deleted: number; failed: number; seen: number; last: Position | null }> {
  const rows = await db
    .select()
    .from(storageDeletions)
    .where(
      and(
        lt(storageDeletions.attempts, OUTBOX.maxAttempts),
        lte(storageDeletions.notBefore, now),
        opts.assetId ? eq(storageDeletions.assetId, opts.assetId) : undefined,
        opts.after
          ? sql`(${storageDeletions.createdAt}, ${storageDeletions.id}) > (${opts.after.createdAt.toISOString()}::timestamptz, ${opts.after.id}::uuid)`
          : undefined,
      ),
    )
    .orderBy(asc(storageDeletions.createdAt), asc(storageDeletions.id))
    .limit(opts.batchSize ?? OUTBOX.batchSize);
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
  const lastRow = rows.at(-1);
  return { deleted, failed, seen: rows.length, last: lastRow ? { createdAt: lastRow.createdAt, id: lastRow.id } : null };
}

/** Batch after batch until nothing due is left or the time budget is spent. Each row is tried at most once per run. */
export async function drainStorageDeletions(
  db: Db,
  storage: ObjectStorage,
  now: Date,
  opts: { batchSize?: number; budgetMs?: number; elapsed?: () => number } = {},
): Promise<{ deleted: number; failed: number }> {
  const started = performance.now();
  const elapsed = opts.elapsed ?? (() => performance.now() - started);
  const batchSize = opts.batchSize ?? OUTBOX.batchSize;
  const budget = opts.budgetMs ?? OUTBOX.drainBudgetMs;
  let deleted = 0;
  let failed = 0;
  let after: Position | undefined;
  while (elapsed() <= budget) {
    const batch = await processStorageDeletions(db, storage, now, { batchSize, after });
    deleted += batch.deleted;
    failed += batch.failed;
    if (batch.seen < batchSize || !batch.last) break;
    after = batch.last;
  }
  return { deleted, failed };
}

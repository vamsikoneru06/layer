import { and, eq, lt } from "drizzle-orm";
import { assets, rateLimits, session, storageDeletions, verification } from "../db/schema";
import type { Db } from "../db/types";
import { processStorageDeletions } from "../storage/outbox";
import type { ObjectStorage } from "../storage/types";

const HOUR = 3_600_000;

/** Longest rate-limit window is a day (RATE_LIMITS); keep one extra day of history. */
export const CLEANUP = { pendingUploadMaxAgeMs: 24 * HOUR, rateLimitRetentionMs: 48 * HOUR } as const;

export type CleanupResult = Awaited<ReturnType<typeof runCleanup>>;

export async function runCleanup(db: Db, storage: ObjectStorage | null, now: Date) {
  const pendingCutoff = new Date(now.getTime() - CLEANUP.pendingUploadMaxAgeMs);
  const pendingUploadsPurged = await db.transaction(async (tx) => {
    const stale = await tx
      .delete(assets)
      .where(and(eq(assets.status, "pending"), lt(assets.createdAt, pendingCutoff)))
      .returning({ storageKey: assets.storageKey, visibility: assets.visibility });
    if (stale.length > 0) {
      await tx.insert(storageDeletions).values(stale.map((a) => ({ bucket: a.visibility, storageKey: a.storageKey, createdAt: now })));
    }
    return stale.length;
  });
  const windows = await db
    .delete(rateLimits)
    .where(lt(rateLimits.windowStart, new Date(now.getTime() - CLEANUP.rateLimitRetentionMs)))
    .returning({ key: rateLimits.key });
  const verifications = await db.delete(verification).where(lt(verification.expiresAt, now)).returning({ id: verification.id });
  const sessions = await db.delete(session).where(lt(session.expiresAt, now)).returning({ id: session.id });
  const outbox = storage ? await processStorageDeletions(db, storage) : { deleted: 0, failed: 0 };
  return {
    pendingUploadsPurged,
    rateLimitWindowsDeleted: windows.length,
    verificationsDeleted: verifications.length,
    sessionsDeleted: sessions.length,
    storageDeleted: outbox.deleted,
    storageFailed: outbox.failed,
  };
}

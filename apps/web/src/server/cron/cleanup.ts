import { and, eq, lt } from "drizzle-orm";
import { assets, bugReports, rateLimits, session, storageDeletions, verification } from "../db/schema";
import type { Db } from "../db/types";
import { objectDeletion } from "../assets/repository";
import { drainStorageDeletions } from "../storage/outbox";
import type { ObjectStorage } from "../storage/types";

const HOUR = 3_600_000;

/** Longest rate-limit window is a day (RATE_LIMITS); keep one extra day of history. */
/** When Vercel Cron calls the cleanup (UTC); must match vercel.json. Hobby allows one run a day. */
export const CLEANUP_SCHEDULE = "0 3 * * *";

/** Bug reports are kept 180 days, as the Privacy page says. */
export const CLEANUP = { pendingUploadMaxAgeMs: 24 * HOUR, rateLimitRetentionMs: 48 * HOUR, bugReportRetentionMs: 180 * 24 * HOUR } as const;

export type CleanupResult = Awaited<ReturnType<typeof runCleanup>>;

export async function runCleanup(db: Db, storage: ObjectStorage | null, now: Date) {
  const pendingCutoff = new Date(now.getTime() - CLEANUP.pendingUploadMaxAgeMs);
  const pendingUploadsPurged = await db.transaction(async (tx) => {
    const stale = await tx
      .delete(assets)
      .where(and(eq(assets.status, "pending"), lt(assets.createdAt, pendingCutoff)))
      .returning({ id: assets.id, ownerId: assets.ownerId, visibility: assets.visibility, storageKey: assets.storageKey, bytes: assets.bytes });
    // Their staging objects were queued when the upload URL was issued.
    if (stale.length > 0) await tx.insert(storageDeletions).values(stale.map((a) => objectDeletion(a, now)));
    return stale.length;
  });
  // Independent tables, so the four purges run at once.
  const [windows, verifications, sessions, bugs] = await Promise.all([
    db
      .delete(rateLimits)
      .where(lt(rateLimits.windowStart, new Date(now.getTime() - CLEANUP.rateLimitRetentionMs)))
      .returning({ key: rateLimits.key }),
    db.delete(verification).where(lt(verification.expiresAt, now)).returning({ id: verification.id }),
    db.delete(session).where(lt(session.expiresAt, now)).returning({ id: session.id }),
    db
      .delete(bugReports)
      .where(lt(bugReports.createdAt, new Date(now.getTime() - CLEANUP.bugReportRetentionMs)))
      .returning({ id: bugReports.id }),
  ]);
  const outbox = storage ? await drainStorageDeletions(db, storage, now) : { deleted: 0, failed: 0 };
  return {
    pendingUploadsPurged,
    rateLimitWindowsDeleted: windows.length,
    verificationsDeleted: verifications.length,
    sessionsDeleted: sessions.length,
    bugReportsDeleted: bugs.length,
    storageDeleted: outbox.deleted,
    storageFailed: outbox.failed,
  };
}

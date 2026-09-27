import { storageDeletions } from "../db/schema";
import type { Db } from "../db/types";
import { HttpError } from "../http/problem";
import type { ObjectRef, ObjectStorage } from "./types";

export interface Copy {
  from: ObjectRef;
  to: ObjectRef;
}

/** Queues objects for the cleanup cron, e.g. copies whose database rows never got written. */
export async function queueObjects(db: Db, refs: readonly ObjectRef[], now: Date): Promise<void> {
  if (refs.length === 0) return;
  await db.insert(storageDeletions).values(refs.map((r) => ({ bucket: r.bucket, storageKey: r.key, createdAt: now, notBefore: now })));
}

/**
 * Copies every object or none: on a failure, every copy attempted so far (the failing one may still
 * have landed) is queued for deletion and the caller gets 503.
 */
export async function copyAll(db: Db, storage: ObjectStorage, copies: readonly Copy[], now: Date): Promise<void> {
  const attempted: ObjectRef[] = [];
  try {
    for (const c of copies) {
      attempted.push(c.to);
      await storage.copy(c.from, c.to);
    }
  } catch {
    await queueObjects(db, attempted, now);
    throw new HttpError(503, "Service Unavailable", "Photo storage is unavailable. Try again in a moment.");
  }
}

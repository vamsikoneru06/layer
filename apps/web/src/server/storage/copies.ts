import { inArray } from "drizzle-orm";
import { storageDeletions } from "../db/schema";
import type { Db } from "../db/types";
import { HttpError } from "../http/problem";
import type { ObjectRef, ObjectStorage } from "./types";

export interface Copy {
  from: ObjectRef;
  to: ObjectRef;
  /** The asset row the copy will belong to, and its size: it's charged to the owner until that row exists. */
  assetId: string;
  bytes: number;
}

/** How long a copy stays registered for deletion if the request that made it never finishes (e.g. a serverless timeout). */
const RESERVATION_MS = 60 * 60 * 1000;

/**
 * Copies every object or none. Each destination is first registered in the deletion queue, due in an
 * hour and charged to `owner`, so a request killed mid-copy leaves nothing uncharged or undeletable.
 * Returns the registrations: call `releaseCopies` in the transaction that records the copies, or
 * `dropCopies` if that transaction fails. A failed copy drops them itself and answers 503.
 */
export async function copyAll(db: Db, storage: ObjectStorage, copies: readonly Copy[], owner: string, now: Date): Promise<string[]> {
  if (copies.length === 0) return [];
  const rows = await db
    .insert(storageDeletions)
    .values(
      copies.map((c) => ({
        bucket: c.to.bucket,
        storageKey: c.to.key,
        ownerId: owner,
        assetId: c.assetId,
        bytes: c.bytes,
        createdAt: now,
        notBefore: new Date(now.getTime() + RESERVATION_MS),
      })),
    )
    .returning({ id: storageDeletions.id });
  const ids = rows.map((r) => r.id);
  try {
    for (const c of copies) await storage.copy(c.from, c.to);
  } catch {
    await dropCopies(db, ids, now);
    throw new HttpError(503, "Service Unavailable", "Photo storage is unavailable. Try again in a moment.");
  }
  return ids;
}

/** The copies are recorded: they're no longer up for deletion. */
export async function releaseCopies(db: Db, ids: readonly string[]): Promise<void> {
  if (ids.length > 0) await db.delete(storageDeletions).where(inArray(storageDeletions.id, [...ids]));
}

/** The copies won't be recorded: delete them at the next cleanup. */
export async function dropCopies(db: Db, ids: readonly string[], now: Date): Promise<void> {
  if (ids.length > 0) await db.update(storageDeletions).set({ notBefore: now }).where(inArray(storageDeletions.id, [...ids]));
}

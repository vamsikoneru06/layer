import { count, eq } from "drizzle-orm";
import { designs, folders, user } from "./db/schema";
import type { Db } from "./db/types";
import { unprocessable } from "./http/problem";

/** Per-user row caps. Each design holds up to LIMITS.docBytes, so this bounds storage per account. */
export const QUOTAS = { designs: 500, folders: 100 } as const;

const tables = { designs, folders };

/** Counts and inserts in one transaction, holding the owner's row lock so concurrent creates can't both pass the count. */
export function insertWithinQuota<T>(db: Db, ownerId: string, resource: keyof typeof QUOTAS, insert: (tx: Db) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.select({ id: user.id }).from(user).where(eq(user.id, ownerId)).for("no key update");
    const table = tables[resource];
    const [row] = await tx.select({ n: count() }).from(table).where(eq(table.ownerId, ownerId));
    const max = QUOTAS[resource];
    if ((row?.n ?? 0) >= max) throw unprocessable(`You can have at most ${max} ${resource}. Delete some to make room.`, { limit: max });
    return insert(tx);
  });
}

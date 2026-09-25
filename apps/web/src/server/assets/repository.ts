import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { assets } from "../db/schema";
import type { Db } from "../db/types";
import { isUuid } from "../http/ids";

/**
 * Returns the ids from `refs` the owner may NOT place in a document: anything that isn't a ready
 * asset of the claimed kind that the owner owns, the system owns, or that is public.
 */
export async function findUnusableAssets(db: Db, ownerId: string, refs: { id: string; kind: "photo" | "sticker" }[]): Promise<string[]> {
  const candidates = refs.map((r) => r.id).filter(isUuid).map((id) => id.toLowerCase());
  const rows =
    candidates.length === 0
      ? []
      : await db
          .select({ id: assets.id, kind: assets.kind })
          .from(assets)
          .where(
            and(
              inArray(assets.id, candidates),
              eq(assets.status, "ready"),
              or(eq(assets.ownerId, ownerId), isNull(assets.ownerId), eq(assets.visibility, "public")),
            ),
          );
  const usable = new Map(rows.map((r) => [r.id, r.kind]));
  return refs.filter((r) => usable.get(r.id.toLowerCase()) !== r.kind).map((r) => r.id);
}

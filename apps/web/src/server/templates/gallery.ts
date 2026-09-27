import type { Db } from "../db/types";
import { decodeCursor, encodeCursor } from "../http/cursor";
import { isUuid } from "../http/ids";
import { badRequest } from "../http/problem";
import { listTemplates, type RankCursor } from "./repository";
import { toTemplateJson } from "./view";

export type GallerySort = "popular" | "new" | "featured";

/** uses_count is an int4; a larger cursor value would make Postgres fail the comparison. */
const INT4_MAX = 2_147_483_647;

export const encodeRankCursor = (c: RankCursor) => Buffer.from(JSON.stringify([c.uses, c.id])).toString("base64url");

export function decodeRankCursor(value: string): RankCursor {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (Array.isArray(parsed) && parsed.length === 2 && Number.isInteger(parsed[0]) && parsed[0] >= 0 && parsed[0] <= INT4_MAX && typeof parsed[1] === "string" && isUuid(parsed[1])) {
      return { uses: parsed[0], id: parsed[1] };
    }
  } catch {
    // fall through
  }
  throw badRequest("The cursor is invalid.");
}

/** One page of published templates. The popular sort pages by (uses, id), the others by (created, id). */
export async function galleryPage(
  db: Db,
  p: { q?: string; category?: string; format?: string; authorId?: string; sort: GallerySort; cursor?: string; limit: number },
) {
  const filters = { search: p.q, category: p.category, format: p.format, authorId: p.authorId, limit: p.limit };
  const rows =
    p.sort === "popular"
      ? await listTemplates(db, { ...filters, sort: "popular", after: p.cursor ? decodeRankCursor(p.cursor) : undefined })
      : await listTemplates(db, { ...filters, sort: p.sort, after: p.cursor ? decodeCursor(p.cursor) : undefined });
  const hasMore = rows.length > p.limit;
  const items = hasMore ? rows.slice(0, p.limit) : rows;
  const last = items.at(-1);
  const nextCursor =
    !hasMore || !last
      ? null
      : p.sort === "popular"
        ? encodeRankCursor({ uses: last.usesCount, id: last.id })
        : encodeCursor({ at: last.createdAt.toISOString(), id: last.id });
  return { items: items.map(toTemplateJson), nextCursor };
}

import { z } from "zod";
import { isUuid } from "./ids";
import { badRequest } from "./problem";

export interface Cursor {
  at: string;
  id: string;
}

export const pageQuery = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify([c.at, c.id])).toString("base64url");
}

export function decodeCursor(value: string): Cursor {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      typeof parsed[0] === "string" &&
      !Number.isNaN(Date.parse(parsed[0])) &&
      typeof parsed[1] === "string" &&
      isUuid(parsed[1])
    ) {
      return { at: new Date(parsed[0]).toISOString(), id: parsed[1] };
    }
  } catch {
    // fall through
  }
  throw badRequest("The cursor is invalid.");
}

export function toPage<T, J>(
  rows: T[],
  limit: number,
  cursorOf: (row: T) => Cursor,
  toJson: (row: T) => J,
): { items: J[]; nextCursor: string | null } {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items.at(-1);
  return { items: items.map(toJson), nextCursor: hasMore && last !== undefined ? encodeCursor(cursorOf(last)) : null };
}

import { sql } from "drizzle-orm";
import { rateLimits } from "../db/schema";
import type { Db } from "../db/types";

export interface RateLimitRule {
  windowSeconds: number;
  max: number;
}

export interface ConsumeResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * Fixed-window counter. One atomic upsert per call, so concurrent requests can't both slip under
 * the limit: Postgres serialises the increments on the (key, window_start) row.
 */
export async function consume(db: Db, key: string, rule: RateLimitRule, now: Date): Promise<ConsumeResult> {
  const windowMs = rule.windowSeconds * 1000;
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  const [row] = await db
    .insert(rateLimits)
    .values({ key, windowStart, count: 1 })
    .onConflictDoUpdate({ target: [rateLimits.key, rateLimits.windowStart], set: { count: sql`${rateLimits.count} + 1` } })
    .returning({ count: rateLimits.count });
  const count = row?.count ?? Number.POSITIVE_INFINITY;
  return {
    allowed: count <= rule.max,
    remaining: Math.max(0, rule.max - count),
    retryAfterSeconds: Math.max(1, Math.ceil((windowStart.getTime() + windowMs - now.getTime()) / 1000)),
  };
}

/** Better Auth ≥1.7 `rateLimit.customStorage`: one limiter and one table for the whole app. */
export function betterAuthRateLimitStorage(db: Db, now: () => Date) {
  return {
    async consume(key: string, rule: { window: number; max: number }) {
      const r = await consume(db, `auth:${key}`, { windowSeconds: rule.window, max: rule.max }, now());
      return { allowed: r.allowed, retryAfter: r.allowed ? null : r.retryAfterSeconds };
    },
  };
}

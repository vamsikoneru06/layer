import { eq } from "drizzle-orm";
import { user } from "@/server/db/schema";
import type { Db } from "@/server/db/types";
import type { Deps } from "@/server/deps";
import { silentLogger } from "@/server/logging";
import { testConfig } from "./config";

/** Real dependencies except auth: the `x-test-user-id` header names the (real, stored) user. */
export function testDeps(db: Db, overrides: Partial<Deps> = {}): Deps {
  return {
    db,
    config: testConfig,
    logger: silentLogger,
    now: () => new Date(),
    async authenticate(req) {
      const id = req.headers.get("x-test-user-id");
      if (!id) return null;
      const [row] = await db
        .select({ id: user.id, email: user.email, role: user.role, handle: user.handle })
        .from(user)
        .where(eq(user.id, id));
      return row ?? null;
    },
    ...overrides,
  };
}

/** A clock that advances one second per call, so rows created in sequence get distinct, ordered timestamps. */
export function tickingClock(start = Date.parse("2026-09-25T09:00:00.000Z")): () => Date {
  let tick = 0;
  return () => new Date(start + tick++ * 1000);
}

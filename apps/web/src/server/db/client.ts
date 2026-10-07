import "server-only";
import { attachDatabasePool } from "@vercel/functions";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
import type { Db } from "./types";

/**
 * Fail fast instead of holding a request open: an unreachable database errors after 5 s, a stuck query after 15 s.
 * The query limit is enforced by the client, since Neon's pooler rejects a statement_timeout startup parameter.
 */
export const DB_TIMEOUTS = { connectionTimeoutMillis: 5_000, query_timeout: 15_000 } as const;

export function createDb(databaseUrl: string, onIdleError: (err: Error) => void): { db: Db; pool: Pool } {
  const pool = new Pool({ connectionString: databaseUrl, max: 5, idleTimeoutMillis: 10_000, ...DB_TIMEOUTS });
  // The server can drop an idle client (Neon does); pg then emits "error" on the pool, which would
  // crash the process if nothing listened. The pool discards that client and opens a new one on demand.
  pool.on("error", onIdleError);
  // On Vercel (Fluid compute), close idle clients before the instance suspends instead of leaking them; a no-op elsewhere.
  attachDatabasePool(pool);
  return { db: drizzle(pool, { schema }), pool };
}

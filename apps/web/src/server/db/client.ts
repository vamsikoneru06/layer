import "server-only";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
import type { Db } from "./types";

export function createDb(databaseUrl: string, onIdleError: (err: Error) => void): { db: Db; pool: Pool } {
  const pool = new Pool({ connectionString: databaseUrl, max: 5, idleTimeoutMillis: 10_000 });
  // The server can drop an idle client (Neon does); pg then emits "error" on the pool, which would
  // crash the process if nothing listened. The pool discards that client and opens a new one on demand.
  pool.on("error", onIdleError);
  return { db: drizzle(pool, { schema }), pool };
}

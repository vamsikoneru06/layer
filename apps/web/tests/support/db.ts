import { fileURLToPath } from "node:url";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/server/db/schema";
import type { Db } from "@/server/db/types";
import { scopeStatements, scopedUserId } from "@/server/db/user-scope";

export interface TestDb {
  db: Db;
  close(): Promise<void>;
}

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

/** A fresh in-memory Postgres with every migration applied. One per test file. */
export async function createTestDb(): Promise<TestDb> {
  const client = new PGlite();
  const db = drizzle(userScoped(client), { schema });
  await migrate(db, { migrationsFolder });
  return { db, close: () => client.close() };
}

/**
 * PGlite's counterpart of UserScopedPool: inside runAsUser, statements run as vash_app under row-level security,
 * so every handler test also exercises the policies. PGlite connects as a superuser, which RLS would otherwise skip.
 */
function userScoped(client: PGlite): PGlite {
  return new Proxy(client, {
    get(target, prop) {
      if (prop === "query") {
        return (query: string, params?: unknown[], options?: object) => {
          const userId = scopedUserId();
          if (!userId) return target.query(query, params, options);
          return target.transaction(async (tx) => {
            await tx.exec(scopeStatements(userId));
            return tx.query(query, params, options);
          });
        };
      }
      if (prop === "transaction") {
        return <T>(fn: (tx: Transaction) => Promise<T>) => {
          const userId = scopedUserId();
          return target.transaction(async (tx) => {
            if (userId) await tx.exec(scopeStatements(userId));
            return fn(tx);
          });
        };
      }
      const value: unknown = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/** Drizzle wraps driver errors ("Failed query: …"); return the database's own message. */
export async function dbErrorMessage(query: Promise<unknown>): Promise<string> {
  try {
    await query;
  } catch (err) {
    const cause = (err as { cause?: unknown }).cause;
    return cause instanceof Error ? cause.message : String(err);
  }
  throw new Error("expected the query to fail");
}

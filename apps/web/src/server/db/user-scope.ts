import { AsyncLocalStorage } from "node:async_hooks";
import type { Pool, PoolClient, QueryConfig } from "pg";

/**
 * Row-level security (migration 0007) as a second line behind the owner filter every repository query has.
 * Inside `runAsUser`, every statement runs as the `vash_app` role with `vash.user_id` set, so Postgres itself hides
 * other users' designs, folders, share links and private photos. Each statement outside an explicit transaction gets
 * its own short transaction, so commit behaviour is unchanged: what was committed straight away still is.
 */
const scope = new AsyncLocalStorage<{ userId: string } | null>();

/** The signed-in user the current statement runs for, or null for system work (auth, cron, public pages). */
export const scopedUserId = (): string | null => scope.getStore()?.userId ?? null;

// Awaited inside the scope: a Drizzle query only runs when awaited, so returning one unawaited would run it outside.
export const runAsUser = <T>(userId: string, fn: () => PromiseLike<T>): Promise<T> => scope.run({ userId }, async () => await fn());

/**
 * Runs `fn` as the system, for the few vetted reads a request makes of another user's rows (a share link's design).
 * Every query inside must still filter on its own.
 */
export const outsideUserScope = <T>(fn: () => PromiseLike<T>): Promise<T> => scope.run(null, async () => await fn());

/** Better Auth ids are URL-safe random strings; anything else never reaches SQL. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

/** The statements that put a transaction under the user's policies. Ends with the transaction (SET LOCAL). */
export function scopeStatements(userId: string): string {
  if (!SAFE_ID.test(userId)) throw new Error("user id is not safe to scope a query with");
  return `SET LOCAL ROLE vash_app; SELECT set_config('vash.user_id', '${userId}', true)`;
}

const isBegin = (config: unknown): boolean => {
  const text = typeof config === "string" ? config : (config as { text?: unknown } | null)?.text;
  return typeof text === "string" && /^\s*begin\b/i.test(text);
};

/**
 * What Drizzle sees in place of the pg Pool. Drizzle treats anything whose class name contains "Pool" as a pool:
 * plain statements go through `query`, transactions through `connect` and a "begin" statement.
 */
export class UserScopedPool {
  constructor(readonly pool: Pool) {}

  async query(config: string | QueryConfig, values?: unknown[]) {
    const userId = scopedUserId();
    if (!userId) return this.pool.query(config, values);
    const client = await this.pool.connect();
    let broken: Error | undefined;
    try {
      await client.query(`BEGIN; ${scopeStatements(userId)}`);
      const result = await client.query(config, values);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK").catch((rollbackErr: Error) => (broken = rollbackErr));
      throw err;
    } finally {
      // A client that can't roll back is in an unknown state; passing the error makes the pool discard it.
      client.release(broken);
    }
  }

  async connect(): Promise<PoolClient> {
    const client = await this.pool.connect();
    const userId = scopedUserId();
    if (!userId) return client;
    const query = client.query.bind(client) as (config: unknown, values?: unknown) => Promise<unknown>;
    const release = client.release;
    // Drizzle opens every transaction with "begin"; scope it before anything else runs in it.
    Object.assign(client, {
      query: async (config: unknown, values?: unknown) => {
        const result = await query(config, values);
        if (isBegin(config)) await query(scopeStatements(userId));
        return result;
      },
      release: (err?: Error | boolean) => {
        // Undo the wrapping before the client goes back to the pool: query is the prototype's, release the pool's.
        delete (client as Partial<PoolClient>).query;
        client.release = release;
        return release.call(client, err);
      },
    });
    return client;
  }
}

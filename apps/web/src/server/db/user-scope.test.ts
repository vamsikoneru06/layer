import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { runAsUser, scopeStatements, UserScopedPool } from "./user-scope";

/** A stand-in pg pool that records every statement and how each client was released. */
function fakePool(...failOn: string[]) {
  return makeFakePool(failOn, null);
}

/** The same, but COMMIT only completes when the test calls `finishCommit`. */
fakePool.withSlowCommit = () => {
  let finish = () => {};
  const commit = new Promise<void>((resolve) => (finish = resolve));
  return { ...makeFakePool([], commit), finishCommit: () => finish() };
};

function makeFakePool(failOn: string[], commit: Promise<void> | null) {
  const log: string[] = [];
  const text = (config: unknown) => (typeof config === "string" ? config : (config as { text: string }).text);
  const run = async (config: unknown) => {
    log.push(text(config));
    if (text(config) === "COMMIT" && commit) await commit;
    if (failOn.includes(text(config))) throw new Error("boom");
    return { rows: [] };
  };
  class Client {
    query(config: unknown) {
      return run(config);
    }
  }
  const pool = {
    query: (config: unknown) => run(config),
    async connect() {
      const client = new Client() as Client & { release: (err?: unknown) => void };
      client.release = (err) => log.push(err ? "release(discard)" : "release");
      return client;
    },
  };
  return { log, scoped: new UserScopedPool(pool as unknown as Pool) };
}

describe("UserScopedPool", () => {
  it("passes statements straight through outside a user scope", async () => {
    const { log, scoped } = fakePool();
    await scoped.query("select 1");
    expect(log).toEqual(["select 1"]);
  });

  it("wraps each statement for a user in its own scoped transaction", async () => {
    const { log, scoped } = fakePool();
    await runAsUser("u_1", () => scoped.query("insert x"));
    expect(log).toEqual([`BEGIN; ${scopeStatements("u_1")}`, "insert x", "COMMIT", "release"]);
  });

  it("answers a read before its read-only transaction commits, and releases the client only after", async () => {
    const { log, scoped, finishCommit } = fakePool.withSlowCommit();
    const rows = await runAsUser("u_1", () => scoped.query({ text: "select * from designs" }));
    expect(rows).toEqual({ rows: [] });
    expect(log).toEqual([`BEGIN READ ONLY; ${scopeStatements("u_1")}`, "select * from designs", "COMMIT"]);
    finishCommit();
    await new Promise((r) => setTimeout(r, 0));
    expect(log.at(-1)).toBe("release");
  });

  it("waits for COMMIT before answering a write", async () => {
    const { log, scoped, finishCommit } = fakePool.withSlowCommit();
    let done = false;
    const write = runAsUser("u_1", () => scoped.query("update designs set title = 'x'")).then(() => (done = true));
    await new Promise((r) => setTimeout(r, 0));
    expect(done).toBe(false);
    finishCommit();
    await write;
    expect(log).toEqual([`BEGIN; ${scopeStatements("u_1")}`, "update designs set title = 'x'", "COMMIT", "release"]);
  });

  it("treats a statement that only starts like a read conservatively", async () => {
    const { log, scoped } = fakePool();
    await runAsUser("u_1", () => scoped.query("with gone as (delete from designs returning id) select * from gone"));
    expect(log[0]).toBe(`BEGIN; ${scopeStatements("u_1")}`);
  });

  it("discards the client when a read's deferred COMMIT fails", async () => {
    const { log, scoped } = fakePool("COMMIT");
    await runAsUser("u_1", () => scoped.query("select 1"));
    await new Promise((r) => setTimeout(r, 0));
    expect(log.at(-1)).toBe("release(discard)");
  });

  it("rolls back and still releases when the statement fails", async () => {
    const { log, scoped } = fakePool("insert x");
    await expect(runAsUser("u_1", () => scoped.query("insert x"))).rejects.toThrow("boom");
    expect(log).toEqual([`BEGIN; ${scopeStatements("u_1")}`, "insert x", "ROLLBACK", "release"]);
  });

  it("discards a client that can't roll back", async () => {
    const { log, scoped } = fakePool("insert x", "ROLLBACK");
    await expect(runAsUser("u_1", () => scoped.query("insert x"))).rejects.toThrow("boom");
    expect(log.at(-1)).toBe("release(discard)");
  });

  it("scopes a Drizzle transaction right after its begin, and unwraps the client on release", async () => {
    const { log, scoped } = fakePool();
    const client = await runAsUser("u_1", () => scoped.connect());
    await client.query({ text: "begin" } as never);
    await client.query("select 1");
    await client.query("commit");
    client.release();
    expect(log).toEqual(["begin", scopeStatements("u_1"), "select 1", "commit", "release"]);
    expect(Object.hasOwn(client, "query")).toBe(false);
  });

  it("hands out an unwrapped client outside a user scope", async () => {
    const { scoped } = fakePool();
    const client = await scoped.connect();
    expect(Object.hasOwn(client, "query")).toBe(false);
  });
});

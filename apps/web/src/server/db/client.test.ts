import { describe, expect, it, vi } from "vitest";
import { createDb } from "./client";

describe("createDb", () => {
  it("hands idle-client errors to the handler instead of crashing the process", async () => {
    const onIdleError = vi.fn();
    const { pool } = createDb("postgres://unused@127.0.0.1:1/unused", onIdleError);
    const err = new Error("terminating connection due to administrator command");
    expect(() => pool.emit("error", err)).not.toThrow();
    expect(onIdleError).toHaveBeenCalledWith(err);
    await pool.end();
  });

  it("gives up on an unreachable database instead of waiting forever", async () => {
    const { pool } = createDb("postgres://unused@127.0.0.1:1/unused", () => {});
    expect(pool.options).toMatchObject({ connectionTimeoutMillis: 5_000, query_timeout: 15_000 });
    await pool.end();
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../../tests/support/db";
import { testDeps } from "../../../tests/support/deps";
import { createUser } from "../../../tests/support/factories";
import { call } from "../../../tests/support/invoke";
import { captureLogger } from "../../../tests/support/logger";
import { createLogger } from "../logging";
import { endpoint } from "./endpoint";
import { HttpError } from "./problem";

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(() => t.close());

const ok = async () => Response.json({ ok: true });

describe("endpoint()", () => {
  it("returns the handler's response with a request id and no-store", async () => {
    const res = await call(endpoint(testDeps(t.db), { auth: "none" }, ok));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects state-changing requests without a same-origin Origin header", async () => {
    const h = endpoint(testDeps(t.db), { auth: "none" }, ok);
    expect((await call(h, { method: "POST", origin: null })).status).toBe(403);
    expect((await call(h, { method: "DELETE", origin: "https://evil.example" })).status).toBe(403);
    expect((await call(h, { method: "PATCH" })).status).toBe(200);
    expect((await call(h, { method: "GET", origin: null })).status).toBe(200);
  });

  it("requires a user, and an admin for admin endpoints", async () => {
    const member = await createUser(t.db);
    const admin = await createUser(t.db, { role: "admin" });
    const needsUser = endpoint(testDeps(t.db), { auth: "user" }, async ({ user }) => Response.json({ id: user.id }));
    const needsAdmin = endpoint(testDeps(t.db), { auth: "admin" }, ok);
    expect((await call(needsUser)).status).toBe(401);
    expect((await call(needsUser, { as: member })).body).toEqual({ id: member.id });
    expect((await call(needsAdmin, { as: member })).status).toBe(403);
    expect((await call(needsAdmin, { as: admin })).status).toBe(200);
  });

  it("renders HttpError as problem+json carrying the same request id as the header", async () => {
    const h = endpoint(testDeps(t.db), { auth: "none" }, async () => {
      throw new HttpError(409, "Conflict", "Version mismatch.", { currentVersion: 4, status: 999 });
    });
    const res = await call(h);
    expect(res.status).toBe(409);
    expect(res.headers.get("content-type")).toBe("application/problem+json");
    expect(res.body).toMatchObject({ type: "about:blank", title: "Conflict", status: 409, detail: "Version mismatch.", currentVersion: 4 });
    expect(res.body.requestId).toBe(res.headers.get("x-request-id"));
  });

  it("hides unexpected errors from the client and logs them without secrets", async () => {
    const lines: string[] = [];
    const logger = createLogger((line) => lines.push(line));
    const h = endpoint(testDeps(t.db, { logger }), { auth: "none" }, async () => {
      const err = new Error('Failed query: select * from "user" where email = $1\nparams: riya@example.test');
      err.name = "DrizzleQueryError";
      (err as Error & { cause?: unknown }).cause = new Error("connect ECONNREFUSED postgres://layer:hunter2@db:5432/layer");
      throw err;
    });
    const res = await call(h);
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toMatch(/hunter2|ECONNREFUSED|riya/);
    const logged = lines.join("\n");
    expect(logged).toContain(res.body.requestId);
    expect(logged).toContain("ECONNREFUSED");
    expect(logged).not.toMatch(/hunter2|riya@example|select \* from/);
  });

  it("rate-limits per user and per IP with Retry-After", async () => {
    const u = await createUser(t.db);
    const rule = { windowSeconds: 60, max: 2 };
    const byUser = endpoint(testDeps(t.db), { auth: "user", rateLimit: { name: "t-user", rule, by: "user" } }, ok);
    const statuses = [];
    for (let i = 0; i < 3; i++) statuses.push((await call(byUser, { as: u })).status);
    expect(statuses).toEqual([200, 200, 429]);

    const byIp = endpoint(testDeps(t.db), { auth: "none", rateLimit: { name: "t-ip", rule, by: "ip" } }, ok);
    await call(byIp, { ip: "198.51.100.1" });
    await call(byIp, { ip: "198.51.100.1" });
    const limited = await call(byIp, { ip: "198.51.100.1" });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await call(byIp, { ip: "198.51.100.2" })).status).toBe(200);
  });

  it("never calls the authenticator for auth: none", async () => {
    let calls = 0;
    const deps = testDeps(t.db, { authenticate: async () => (calls++, null) });
    await call(endpoint(deps, { auth: "none" }, ok));
    expect(calls).toBe(0);
  });

  it("keeps share tokens out of request logs", async () => {
    const logger = captureLogger();
    await call(endpoint(testDeps(t.db, { logger }), { auth: "none" }, ok), { path: "/api/shared/SECRETTOKEN123/remix" });
    expect(JSON.stringify(logger.entries)).not.toContain("SECRETTOKEN123");
  });
});

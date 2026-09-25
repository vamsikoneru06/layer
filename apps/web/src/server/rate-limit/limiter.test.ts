import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../../tests/support/db";
import { betterAuthRateLimitStorage, consume } from "./limiter";

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(() => t.close());

const rule = { windowSeconds: 60, max: 3 };
const at = (iso: string) => new Date(iso);

describe("consume (fixed window)", () => {
  it("allows up to max requests in a window, then denies", async () => {
    const now = at("2026-09-25T10:00:10.000Z");
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await consume(t.db, "k:basic", rule, now));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results.map((r) => r.remaining)).toEqual([2, 1, 0, 0]);
  });

  it("reports seconds until the window ends", async () => {
    const r = await consume(t.db, "k:retry", { windowSeconds: 60, max: 0 }, at("2026-09-25T10:00:10.000Z"));
    expect(r.allowed).toBe(false);
    expect(r.retryAfterSeconds).toBe(50);
  });

  it("starts a fresh count in the next window", async () => {
    for (let i = 0; i < 3; i++) await consume(t.db, "k:roll", rule, at("2026-09-25T10:00:59.000Z"));
    expect((await consume(t.db, "k:roll", rule, at("2026-09-25T10:00:59.500Z"))).allowed).toBe(false);
    expect((await consume(t.db, "k:roll", rule, at("2026-09-25T10:01:00.000Z"))).allowed).toBe(true);
  });

  it("keeps keys independent", async () => {
    const now = at("2026-09-25T11:00:00.000Z");
    for (let i = 0; i < 3; i++) await consume(t.db, "k:a", rule, now);
    expect((await consume(t.db, "k:b", rule, now)).allowed).toBe(true);
  });

  it("counts concurrent requests exactly", async () => {
    const now = at("2026-09-25T12:00:00.000Z");
    const results = await Promise.all(Array.from({ length: 10 }, () => consume(t.db, "k:burst", { windowSeconds: 60, max: 5 }, now)));
    expect(results.filter((r) => r.allowed)).toHaveLength(5);
  });
});

describe("betterAuthRateLimitStorage", () => {
  it("adapts consume to Better Auth's contract under an auth: prefix", async () => {
    const now = at("2026-09-25T13:00:00.000Z");
    const storage = betterAuthRateLimitStorage(t.db, () => now);
    expect(await storage.consume("1.2.3.4/sign-in", { window: 10, max: 1 })).toEqual({ allowed: true, retryAfter: null });
    expect(await storage.consume("1.2.3.4/sign-in", { window: 10, max: 1 })).toEqual({ allowed: false, retryAfter: 10 });
    expect((await consume(t.db, "auth:1.2.3.4/sign-in", { windowSeconds: 10, max: 99 }, now)).remaining).toBe(96);
  });
});

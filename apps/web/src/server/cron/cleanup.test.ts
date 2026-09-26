import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../../tests/support/db";
import { testDeps } from "../../../tests/support/deps";
import { createAsset, createUser } from "../../../tests/support/factories";
import { call } from "../../../tests/support/invoke";
import { memoryStorage } from "../../../tests/support/storage";
import { assets, rateLimits, session, storageDeletions, verification } from "../db/schema";
import { cronHandlers } from "./handlers";

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(() => t.close());

const SECRET = "cron-secret-that-is-at-least-32-characters";
const NOW = new Date("2026-09-26T03:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

describe("GET /api/cron/cleanup", () => {
  it("refuses requests without the right bearer token, or when no secret is configured", async () => {
    const h = cronHandlers(testDeps(t.db), memoryStorage(), SECRET);
    expect((await call(h.cleanup)).status).toBe(401);
    expect((await call(h.cleanup, { headers: { authorization: `Bearer ${SECRET}x` } })).status).toBe(401);
    expect((await call(h.cleanup, { headers: { authorization: SECRET } })).status).toBe(401);
    const unconfigured = cronHandlers(testDeps(t.db), memoryStorage(), null);
    expect((await call(unconfigured.cleanup, { headers: { authorization: "Bearer " } })).status).toBe(401);
  });

  it("purges stale uploads, old windows, expired sign-in rows and drains the outbox, idempotently", async () => {
    const storage = memoryStorage();
    const owner = await createUser(t.db);
    const stale = await createAsset(t.db, { ownerId: owner.id, status: "pending", createdAt: hoursAgo(25) });
    const fresh = await createAsset(t.db, { ownerId: owner.id, status: "pending", createdAt: hoursAgo(1) });
    const oldReady = await createAsset(t.db, { ownerId: owner.id, createdAt: hoursAgo(500) });
    storage.put("private", stale.storageKey, new Uint8Array([1]));
    await t.db.insert(rateLimits).values([
      { key: "old", windowStart: hoursAgo(72), count: 1 },
      { key: "recent", windowStart: hoursAgo(1), count: 1 },
    ]);
    await t.db.insert(verification).values([
      { id: "v-old", identifier: "x", value: "y", expiresAt: hoursAgo(1) },
      { id: "v-live", identifier: "x", value: "y", expiresAt: new Date(NOW.getTime() + 60_000) },
    ]);
    await t.db.insert(session).values([
      { id: "s-old", token: "t-old", userId: owner.id, expiresAt: hoursAgo(1) },
      { id: "s-live", token: "t-live", userId: owner.id, expiresAt: new Date(NOW.getTime() + 60_000) },
    ]);

    const h = cronHandlers(testDeps(t.db, { now: () => NOW }), storage, SECRET);
    const first = await call(h.cleanup, { headers: { authorization: `Bearer ${SECRET}` } });
    expect(first.status).toBe(200);
    expect(first.body).toEqual({
      pendingUploadsPurged: 1,
      rateLimitWindowsDeleted: 1,
      verificationsDeleted: 1,
      sessionsDeleted: 1,
      storageDeleted: 1,
      storageFailed: 0,
    });
    expect(storage.has("private", stale.storageKey)).toBe(false);
    const left = (await t.db.select({ id: assets.id }).from(assets)).map((a) => a.id);
    expect(left).toEqual(expect.arrayContaining([fresh.id, oldReady.id]));
    expect(left).not.toContain(stale.id);
    expect(await t.db.select().from(rateLimits).where(eq(rateLimits.key, "recent"))).toHaveLength(1);
    expect(await t.db.select().from(verification).where(eq(verification.id, "v-live"))).toHaveLength(1);
    expect(await t.db.select().from(session).where(eq(session.id, "s-live"))).toHaveLength(1);

    const second = await call(h.cleanup, { headers: { authorization: `Bearer ${SECRET}` } });
    expect(second.body).toMatchObject({ pendingUploadsPurged: 0, rateLimitWindowsDeleted: 0, storageDeleted: 0 });
  });

  it("still cleans the database when storage isn't configured, keeping the outbox for later", async () => {
    const owner = await createUser(t.db);
    const stale = await createAsset(t.db, { ownerId: owner.id, status: "pending", createdAt: hoursAgo(30) });
    const h = cronHandlers(testDeps(t.db, { now: () => NOW }), null, SECRET);
    const res = await call(h.cleanup, { headers: { authorization: `Bearer ${SECRET}` } });
    expect(res.body).toMatchObject({ pendingUploadsPurged: 1, storageDeleted: 0 });
    expect(await t.db.select().from(storageDeletions).where(eq(storageDeletions.storageKey, stale.storageKey))).toHaveLength(1);
  });
});

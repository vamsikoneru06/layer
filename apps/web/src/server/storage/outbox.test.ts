import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../../tests/support/db";
import { memoryStorage } from "../../../tests/support/storage";
import { storageDeletions } from "../db/schema";
import { drainStorageDeletions, OUTBOX, processStorageDeletions } from "./outbox";

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
beforeEach(async () => {
  await t.db.delete(storageDeletions);
});
afterAll(() => t.close());

const NOW = new Date("2026-09-26T03:00:00.000Z");
const queue = (storageKey: string, extra: Partial<typeof storageDeletions.$inferInsert> = {}) =>
  t.db.insert(storageDeletions).values({ bucket: "private", storageKey, createdAt: new Date("2026-09-25T00:00:00Z"), notBefore: new Date("2026-09-25T00:00:00Z"), ...extra });

describe("processStorageDeletions", () => {
  it("removes queued objects and their rows", async () => {
    const storage = memoryStorage();
    storage.put("private", "u/a/1", new Uint8Array([1]));
    await queue("u/a/1");
    await queue("u/a/already-gone");
    expect(await processStorageDeletions(t.db, storage, NOW)).toMatchObject({ deleted: 2, failed: 0 });
    expect(storage.has("private", "u/a/1")).toBe(false);
    expect(await t.db.select().from(storageDeletions)).toEqual([]);
  });

  it("backs off after a failure and keeps retrying until storage recovers", async () => {
    const storage = memoryStorage();
    storage.put("private", "u/a/stuck", new Uint8Array([1]));
    storage.failRemove.add("u/a/stuck");
    await queue("u/a/stuck");
    let at = NOW;
    for (let i = 1; i <= 10; i++) {
      expect(await processStorageDeletions(t.db, storage, at)).toMatchObject({ failed: 1 });
      const [row] = await t.db.select().from(storageDeletions).where(eq(storageDeletions.storageKey, "u/a/stuck"));
      expect(row?.attempts).toBe(i);
      // Not retried again before its backoff ends, which is capped.
      expect(await processStorageDeletions(t.db, storage, at)).toMatchObject({ failed: 0 });
      expect(row!.notBefore.getTime() - at.getTime()).toBe(Math.min(2 ** i, OUTBOX.maxBackoffHours) * 3_600_000);
      at = row!.notBefore;
    }
    storage.failRemove.delete("u/a/stuck");
    expect(await processStorageDeletions(t.db, storage, at)).toMatchObject({ deleted: 1, failed: 0 });
    expect(storage.has("private", "u/a/stuck")).toBe(false);
    expect(await t.db.select().from(storageDeletions)).toEqual([]);
  });

  it("works oldest first, in batches", async () => {
    const storage = memoryStorage();
    await queue("u/a/new", { createdAt: new Date("2026-09-25T12:00:00Z") });
    await queue("u/a/old", { createdAt: new Date("2026-09-01T00:00:00Z") });
    expect(await processStorageDeletions(t.db, storage, NOW, { batchSize: 1 })).toMatchObject({ deleted: 1, failed: 0 });
    const left = await t.db.select().from(storageDeletions).orderBy(asc(storageDeletions.createdAt));
    expect(left.map((r) => r.storageKey)).toEqual(["u/a/new"]);
  });

  it("leaves rows that aren't due yet", async () => {
    const storage = memoryStorage();
    storage.put("private", "staging/u/1", new Uint8Array([1]));
    await queue("staging/u/1", { notBefore: new Date(NOW.getTime() + 60_000) });
    expect(await processStorageDeletions(t.db, storage, NOW)).toMatchObject({ deleted: 0, failed: 0 });
    expect(storage.has("private", "staging/u/1")).toBe(true);
  });
});

describe("drainStorageDeletions", () => {
  it("empties a backlog far larger than one batch in a single run, trying each failure once", async () => {
    const storage = memoryStorage();
    for (let i = 0; i < 120; i++) await queue(`u/a/${i}`, { createdAt: new Date(Date.UTC(2026, 8, 1, 0, 0, i)) });
    storage.failRemove.add("u/a/7");
    expect(await drainStorageDeletions(t.db, storage, NOW)).toEqual({ deleted: 119, failed: 1 });
    const left = await t.db.select().from(storageDeletions);
    expect(left).toMatchObject([{ storageKey: "u/a/7", attempts: 1 }]);
  });

  it("stops between batches once the time budget is spent", async () => {
    const storage = memoryStorage();
    for (let i = 0; i < 120; i++) await queue(`u/b/${i}`, { createdAt: new Date(Date.UTC(2026, 8, 1, 0, 0, i)) });
    let calls = 0;
    const elapsed = () => (calls++ === 0 ? 0 : OUTBOX.drainBudgetMs + 1);
    expect(await drainStorageDeletions(t.db, storage, NOW, { elapsed })).toEqual({ deleted: OUTBOX.batchSize, failed: 0 });
  });
});

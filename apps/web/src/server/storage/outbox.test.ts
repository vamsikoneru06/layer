import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../../tests/support/db";
import { memoryStorage } from "../../../tests/support/storage";
import { storageDeletions } from "../db/schema";
import { OUTBOX, processStorageDeletions } from "./outbox";

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
beforeEach(async () => {
  await t.db.delete(storageDeletions);
});
afterAll(() => t.close());

const queue = (storageKey: string, extra: Partial<typeof storageDeletions.$inferInsert> = {}) =>
  t.db.insert(storageDeletions).values({ bucket: "private", storageKey, ...extra });

describe("processStorageDeletions", () => {
  it("removes queued objects and their rows", async () => {
    const storage = memoryStorage();
    storage.put("private", "u/a/1", new Uint8Array([1]));
    await queue("u/a/1");
    await queue("u/a/already-gone");
    expect(await processStorageDeletions(t.db, storage)).toEqual({ deleted: 2, failed: 0 });
    expect(storage.has("private", "u/a/1")).toBe(false);
    expect(await t.db.select().from(storageDeletions)).toEqual([]);
  });

  it("keeps failures for a retry, and gives up after the maximum attempts", async () => {
    const storage = memoryStorage();
    storage.failRemove.add("u/a/stuck");
    await queue("u/a/stuck");
    for (let i = 0; i < OUTBOX.maxAttempts; i++) await processStorageDeletions(t.db, storage);
    const [row] = await t.db.select().from(storageDeletions).where(eq(storageDeletions.storageKey, "u/a/stuck"));
    expect(row?.attempts).toBe(OUTBOX.maxAttempts);
    expect(await processStorageDeletions(t.db, storage)).toEqual({ deleted: 0, failed: 0 });
  });

  it("works oldest first, in batches", async () => {
    const storage = memoryStorage();
    await queue("u/a/new", { createdAt: new Date("2026-09-26T00:00:00Z") });
    await queue("u/a/old", { createdAt: new Date("2026-09-01T00:00:00Z") });
    expect(await processStorageDeletions(t.db, storage, 1)).toEqual({ deleted: 1, failed: 0 });
    const left = await t.db.select().from(storageDeletions).orderBy(asc(storageDeletions.createdAt));
    expect(left.map((r) => r.storageKey)).toEqual(["u/a/new"]);
  });
});

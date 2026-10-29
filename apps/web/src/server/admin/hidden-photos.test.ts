import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../../tests/support/db";
import { testDeps, tickingClock } from "../../../tests/support/deps";
import { createAsset, createTemplate, createUser } from "../../../tests/support/factories";
import { call } from "../../../tests/support/invoke";
import { memoryStorage } from "../../../tests/support/storage";
import { assets, auditLog, storageDeletions, templates } from "../db/schema";
import { drainStorageDeletions } from "../storage/outbox";
import { adminHandlers } from "./handlers";

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(() => t.close());

/** A published template with two system-owned public photo copies, as publishing makes them. */
async function publishedWithPhotos(storage: ReturnType<typeof memoryStorage>) {
  const author = await createUser(t.db);
  const tpl = await createTemplate(t.db, { authorId: author.id, status: "published" });
  const copies = [];
  for (let i = 0; i < 2; i++) {
    const row = await createAsset(t.db, { ownerId: null, templateId: tpl.id, visibility: "public", status: "ready", bytes: 1000 + i });
    const key = `t/${tpl.id}/${row.id}`;
    await t.db.update(assets).set({ storageKey: key }).where(eq(assets.id, row.id));
    storage.put("public", key, new Uint8Array([i, 1, 2]));
    copies.push({ id: row.id, key });
  }
  return { tpl, copies };
}

async function setup() {
  const storage = memoryStorage();
  const now = tickingClock();
  const h = adminHandlers(testDeps(t.db, { now }), storage);
  const admin = await createUser(t.db, { role: "admin", twoFactorEnabled: true });
  return { storage, h, admin, now };
}

const visibilities = async (templateId: string) =>
  (await t.db.select({ visibility: assets.visibility }).from(assets).where(eq(assets.templateId, templateId))).map((r) => r.visibility);

describe("hiding a template takes its photos off the public bucket", () => {
  it("moves the copies to private storage on hide, and back on restore, deleting the old objects through the queue", async () => {
    const { storage, h, admin } = await setup();
    const { tpl, copies } = await publishedWithPhotos(storage);
    const moderate = (action: string) => call(h.moderate, { method: "POST", as: admin, params: { id: tpl.id }, body: { action } });

    const hid = await moderate("hide");
    expect(hid.status, JSON.stringify(hid.body)).toBe(200);
    const audits = await t.db.select().from(auditLog).where(eq(auditLog.targetId, tpl.id));
    expect(audits.map((a) => a.meta)).toEqual([{ reportsResolved: 0, photosMoved: 2 }]);
    expect(await visibilities(tpl.id)).toEqual(["private", "private"]);
    for (const c of copies) expect(storage.has("private", c.key)).toBe(true);
    // The public objects are queued for deletion, linked to their (still existing) assets so nobody is charged twice.
    const queued = await t.db.select().from(storageDeletions).where(eq(storageDeletions.bucket, "public"));
    expect(queued.map((q) => q.storageKey).sort()).toEqual(copies.map((c) => c.key).sort());
    expect(queued.every((q) => q.assetId !== null)).toBe(true);
    await drainStorageDeletions(t.db, storage, new Date(Date.now() + 60_000));
    for (const c of copies) expect(storage.has("public", c.key)).toBe(false);

    expect((await moderate("restore")).status).toBe(200);
    expect(await visibilities(tpl.id)).toEqual(["public", "public"]);
    for (const c of copies) expect(storage.has("public", c.key)).toBe(true);
    await drainStorageDeletions(t.db, storage, new Date(Date.now() + 60_000));
    for (const c of copies) expect(storage.has("private", c.key)).toBe(false);
  });

  it("changes nothing when storage fails mid-move", async () => {
    const { storage, h, admin } = await setup();
    const { tpl, copies } = await publishedWithPhotos(storage);
    storage.failCopy.add(copies[1]!.key);
    const res = await call(h.moderate, { method: "POST", as: admin, params: { id: tpl.id }, body: { action: "hide" } });
    expect(res.status).toBe(503);
    const [row] = await t.db.select({ status: templates.status }).from(templates).where(eq(templates.id, tpl.id));
    expect(row!.status).toBe("published");
    expect(await visibilities(tpl.id)).toEqual(["public", "public"]);
    for (const c of copies) expect(storage.has("public", c.key)).toBe(true);
  });

  it("hiding twice, or featuring, moves nothing", async () => {
    const { storage, h, admin } = await setup();
    const { tpl } = await publishedWithPhotos(storage);
    const moderate = (action: string) => call(h.moderate, { method: "POST", as: admin, params: { id: tpl.id }, body: { action } });
    await moderate("feature");
    expect(await visibilities(tpl.id)).toEqual(["public", "public"]);
    await moderate("hide");
    const before = await t.db.select().from(storageDeletions).where(and(eq(storageDeletions.bucket, "public")));
    await moderate("hide");
    const after = await t.db.select().from(storageDeletions).where(and(eq(storageDeletions.bucket, "public")));
    expect(after.length).toBe(before.length);
  });
});

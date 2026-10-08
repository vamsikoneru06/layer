import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../../tests/support/db";
import { testDeps, tickingClock } from "../../../tests/support/deps";
import { emptyDoc } from "../../../tests/support/docs";
import { createAsset, createTemplate, createUser } from "../../../tests/support/factories";
import { call } from "../../../tests/support/invoke";
import { memoryStorage } from "../../../tests/support/storage";
import { assets, designs, storageDeletions, templates } from "../db/schema";
import { RATE_LIMITS } from "../rate-limit/rules";
import { assetHandlers } from "./handlers";

let t: TestDb;
let storage: ReturnType<typeof memoryStorage>;
let h: ReturnType<typeof assetHandlers>;
beforeAll(async () => {
  t = await createTestDb();
  storage = memoryStorage();
  h = assetHandlers(testDeps(t.db, { now: tickingClock() }), storage);
});
afterAll(() => t.close());

const resolve = (viewer: { id: string } | null, ids: unknown) => call(h.resolve, { method: "POST", as: viewer, body: { ids } });

describe("GET /api/assets", () => {
  it("lists only the caller's ready assets, newest first, filtered by kind and paginated", async () => {
    const alice = await createUser(t.db);
    const bob = await createUser(t.db);
    const older = await createAsset(t.db, { ownerId: alice.id, createdAt: new Date("2026-09-01T00:00:00Z") });
    const newer = await createAsset(t.db, { ownerId: alice.id, createdAt: new Date("2026-09-02T00:00:00Z") });
    await createAsset(t.db, { ownerId: alice.id, kind: "thumbnail" });
    await createAsset(t.db, { ownerId: alice.id, status: "pending" });
    await createAsset(t.db, { ownerId: bob.id });

    const first = await call(h.list, { as: alice, path: "/api/assets?kind=photo&limit=1" });
    expect(first.body.items.map((a: { id: string }) => a.id)).toEqual([newer.id]);
    const second = await call(h.list, { as: alice, path: `/api/assets?kind=photo&limit=1&cursor=${first.body.nextCursor}` });
    expect(second.body).toMatchObject({ items: [{ id: older.id }], nextCursor: null });
    expect((await call(h.list, { as: alice, path: "/api/assets?kind=video" })).status).toBe(400);
    expect((await call(h.list)).status).toBe(401);
  });
});

describe("POST /api/assets/resolve", () => {
  it("stops resolving a hidden template's photos, except for its author and admins", async () => {
    const author = await createUser(t.db);
    const bob = await createUser(t.db);
    const admin = await createUser(t.db, { role: "admin", twoFactorEnabled: true });
    const tpl = await createTemplate(t.db, { authorId: author.id });
    const copy = await createAsset(t.db, { ownerId: null, visibility: "public", templateId: tpl.id });
    const ids = (res: { body: { assets: { id: string }[] } }) => res.body.assets.map((a) => a.id);
    expect(ids(await resolve(null, [copy.id]))).toEqual([copy.id]);

    await t.db.update(templates).set({ status: "hidden" }).where(eq(templates.id, tpl.id));
    expect(ids(await resolve(null, [copy.id]))).toEqual([]);
    expect(ids(await resolve(bob, [copy.id]))).toEqual([]);
    expect(ids(await resolve(author, [copy.id]))).toEqual([copy.id]);
    expect(ids(await resolve(admin, [copy.id]))).toEqual([copy.id]);
  });

  it("signs the caller's private assets for an hour and links public and system assets", async () => {
    const alice = await createUser(t.db);
    const own = await createAsset(t.db, { ownerId: alice.id });
    const pub = await createAsset(t.db, { ownerId: alice.id, visibility: "public" });
    const system = await createAsset(t.db, { ownerId: null, visibility: "public", kind: "sticker" });
    const res = await resolve(alice, [own.id, pub.id, system.id]);
    expect(res.status).toBe(200);
    const byId = Object.fromEntries(res.body.assets.map((a: { id: string }) => [a.id, a]));
    expect(byId[own.id].url).toBe(`https://storage.test/private/${own.storageKey}?op=get&expires=3600`);
    expect(new Date(byId[own.id].expiresAt).toISOString()).toBe(byId[own.id].expiresAt);
    expect(byId[pub.id]).toEqual({ id: pub.id, url: `https://cdn.test/${pub.storageKey}`, expiresAt: null });
    expect(byId[system.id].url).toBe(`https://cdn.test/${system.storageKey}`);
  });

  it("silently omits foreign, pending, unknown and duplicate ids", async () => {
    const alice = await createUser(t.db);
    const bob = await createUser(t.db);
    const own = await createAsset(t.db, { ownerId: alice.id });
    const bobs = await createAsset(t.db, { ownerId: bob.id });
    const pending = await createAsset(t.db, { ownerId: alice.id, status: "pending" });
    const res = await resolve(alice, [own.id, own.id, bobs.id, pending.id, "00000000-0000-4000-8000-000000000000"]);
    expect(res.body.assets.map((a: { id: string }) => a.id)).toEqual([own.id]);
  });

  it("lets guests resolve public and system assets only", async () => {
    const alice = await createUser(t.db);
    const priv = await createAsset(t.db, { ownerId: alice.id });
    const pub = await createAsset(t.db, { ownerId: alice.id, visibility: "public" });
    const res = await resolve(null, [priv.id, pub.id]);
    expect(res.body.assets.map((a: { id: string }) => a.id)).toEqual([pub.id]);
  });

  it("resolves bundled sample photos to the site's own files, even without storage", async () => {
    const sample = await createAsset(t.db, { ownerId: null, visibility: "public", storageKey: `bundled/samples/test-${Date.now()}.jpg` });
    const withStorage = await resolve(null, [sample.id]);
    expect(withStorage.body.assets).toEqual([{ id: sample.id, url: sample.storageKey.replace("bundled/", "/"), expiresAt: null }]);

    const alice = await createUser(t.db);
    const own = await createAsset(t.db, { ownerId: alice.id });
    const noStorage = assetHandlers(testDeps(t.db, { now: tickingClock() }), null);
    const res = await call(noStorage.resolve, { method: "POST", as: alice, body: { ids: [sample.id, own.id] } });
    expect(res.status).toBe(200);
    expect(res.body.assets.map((a: { id: string }) => a.id)).toEqual([sample.id]);
  });

  it.each([[[]], [["not-a-uuid"]], [Array.from({ length: 201 }, () => "00000000-0000-4000-8000-000000000000")], ["one"]])("rejects ids %# with 400", async (ids) => {
    const alice = await createUser(t.db);
    expect((await resolve(alice, ids)).status).toBe(400);
  });
});

describe("DELETE /api/assets/:id", () => {
  it("removes the caller's asset and its object, and clears design thumbnails", async () => {
    const alice = await createUser(t.db);
    const asset = await createAsset(t.db, { ownerId: alice.id });
    storage.put("private", asset.storageKey, new Uint8Array([1]));
    const [design] = await t.db.insert(designs).values({ ownerId: alice.id, title: "Card", doc: emptyDoc(), thumbnailAssetId: asset.id }).returning();
    expect((await call(h.remove, { method: "DELETE", as: alice, params: { id: asset.id } })).status).toBe(204);
    expect(await t.db.select().from(assets).where(eq(assets.id, asset.id))).toEqual([]);
    expect(storage.has("private", asset.storageKey)).toBe(false);
    const [after] = await t.db.select().from(designs).where(eq(designs.id, design!.id));
    expect(after?.thumbnailAssetId).toBeNull();
  });

  it("queues the object when storage is down, and answers 404 for anyone else's asset", async () => {
    const alice = await createUser(t.db);
    const bob = await createUser(t.db);
    const asset = await createAsset(t.db, { ownerId: alice.id, visibility: "public" });
    expect((await call(h.remove, { method: "DELETE", as: bob, params: { id: asset.id } })).status).toBe(404);
    storage.failRemove.add(asset.storageKey);
    expect((await call(h.remove, { method: "DELETE", as: alice, params: { id: asset.id } })).status).toBe(204);
    expect(await t.db.select().from(storageDeletions).where(eq(storageDeletions.storageKey, asset.storageKey))).toMatchObject([{ bucket: "public" }]);
  });
});

describe("asset writes", () => {
  it("share the per-user write limit", async () => {
    const alice = await createUser(t.db);
    const asset = await createAsset(t.db, { ownerId: alice.id, status: "pending" });
    const fixed = new Date("2026-09-26T10:00:05.000Z");
    const limited = assetHandlers(testDeps(t.db, { now: () => fixed }), storage);
    const missing = "00000000-0000-4000-8000-000000000000";
    for (let i = 0; i < RATE_LIMITS.userWrite.max; i++) {
      expect((await call(limited.remove, { method: "DELETE", as: alice, params: { id: missing } })).status).toBe(404);
    }
    expect((await call(limited.remove, { method: "DELETE", as: alice, params: { id: asset.id } })).status).toBe(429);
    expect((await call(limited.complete, { method: "POST", as: alice, params: { id: asset.id }, body: { width: 10, height: 10 } })).status).toBe(429);
  });
});

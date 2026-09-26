import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../../tests/support/db";
import { testDeps } from "../../../tests/support/deps";
import { createAsset, createUser } from "../../../tests/support/factories";
import { call } from "../../../tests/support/invoke";
import { memoryStorage } from "../../../tests/support/storage";
import { assets, storageDeletions } from "../db/schema";
import { processStorageDeletions } from "../storage/outbox";
import { assetHandlers } from "./handlers";
import { UPLOAD_LIMITS } from "./service";

let t: TestDb;
let storage: ReturnType<typeof memoryStorage>;
let h: ReturnType<typeof assetHandlers>;
beforeAll(async () => {
  t = await createTestDb();
  storage = memoryStorage();
  h = assetHandlers(testDeps(t.db), storage);
});
afterAll(() => t.close());

const MB = 1024 * 1024;
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
function file(length: number, signature: number[] = PNG_SIG): Uint8Array {
  const bytes = new Uint8Array(length);
  bytes.set(signature.slice(0, length));
  return bytes;
}

async function requestUpload(owner: { id: string }, body: Record<string, unknown> = { kind: "photo", mime: "image/png", bytes: 64 }) {
  return call(h.requestUpload, { method: "POST", as: owner, body });
}
const stagingOf = (ownerId: string, assetId: string) => `staging/${ownerId}/${assetId}`;
const finalOf = (ownerId: string, assetId: string) => `u/${ownerId}/${assetId}`;
const complete = (owner: { id: string }, id: string) => call(h.complete, { method: "POST", as: owner, params: { id }, body: { width: 1200, height: 900 } });

describe("POST /api/assets/uploads", () => {
  it("creates a pending asset and a presigned PUT to a staging key, bound to the declared type and size", async () => {
    const alice = await createUser(t.db);
    const res = await requestUpload(alice);
    expect(res.status).toBe(201);
    expect(res.body.asset).toMatchObject({ kind: "photo", mime: "image/png", bytes: 64, status: "pending", visibility: "private" });
    const url = new URL(res.body.upload.url);
    expect(url.pathname).toBe(`/private/${stagingOf(alice.id, res.body.asset.id)}`);
    expect(url.searchParams.get("type")).toBe("image/png");
    expect(url.searchParams.get("length")).toBe("64");
    expect(url.searchParams.get("expires")).toBe("300");
    expect(res.body.upload).toMatchObject({ method: "PUT", headers: { "content-type": "image/png" } });
    // The staging object is deleted only after the URL has expired, and counts toward the quota until then.
    const queued = await t.db.select().from(storageDeletions).where(eq(storageDeletions.assetId, res.body.asset.id));
    expect(queued).toMatchObject([{ bucket: "private", storageKey: stagingOf(alice.id, res.body.asset.id), ownerId: alice.id, bytes: 64 }]);
    const createdAt = new Date(res.body.asset.createdAt).getTime();
    expect(queued[0]!.notBefore.getTime() - createdAt).toBe((UPLOAD_LIMITS.uploadUrlSeconds + 3600) * 1000);
  });

  it.each([
    { kind: "photo", mime: "image/svg+xml", bytes: 10 },
    { kind: "photo", mime: "image/gif", bytes: 10 },
    { kind: "sticker", mime: "image/png", bytes: 10 },
    { kind: "photo", mime: "image/png", bytes: 0 },
    { kind: "photo", mime: "image/png", bytes: 15 * MB + 1 },
    { kind: "photo", mime: "image/png", bytes: 10, storageKey: "u/someone-else/x" },
  ])("rejects %j with 400", async (body) => {
    const alice = await createUser(t.db);
    expect((await requestUpload(alice, body)).status).toBe(400);
  });

  it("enforces the 500 MB quota, counting pending uploads", async () => {
    const alice = await createUser(t.db);
    await createAsset(t.db, { ownerId: alice.id, bytes: UPLOAD_LIMITS.storageQuotaBytes - 100 });
    expect((await requestUpload(alice, { kind: "photo", mime: "image/png", bytes: 60 })).status).toBe(201);
    const over = await requestUpload(alice, { kind: "photo", mime: "image/png", bytes: 60 });
    expect(over.status).toBe(422);
    expect(over.body).toMatchObject({ limitBytes: UPLOAD_LIMITS.storageQuotaBytes, usedBytes: UPLOAD_LIMITS.storageQuotaBytes - 40 });
  });

  it("keeps counting a deleted upload toward the quota until its URL has expired and the staging object is gone", async () => {
    const alice = await createUser(t.db);
    await createAsset(t.db, { ownerId: alice.id, bytes: UPLOAD_LIMITS.storageQuotaBytes - 100 });
    const first = await requestUpload(alice, { kind: "photo", mime: "image/png", bytes: 60 });
    expect(first.status).toBe(201);
    expect((await call(h.remove, { method: "DELETE", as: alice, params: { id: first.body.asset.id } })).status).toBe(204);
    // The deleted upload's URL could still write its staging object, so its bytes still count.
    expect((await requestUpload(alice, { kind: "photo", mime: "image/png", bytes: 60 })).status).toBe(422);
    const afterExpiry = new Date(Date.now() + (UPLOAD_LIMITS.uploadUrlSeconds + 3600) * 1000 + 1000);
    await processStorageDeletions(t.db, storage, afterExpiry, { assetId: first.body.asset.id });
    expect((await requestUpload(alice, { kind: "photo", mime: "image/png", bytes: 60 })).status).toBe(201);
  });

  it("allows 60 upload URLs per hour", async () => {
    const bob = await createUser(t.db);
    const fixed = new Date("2026-09-26T10:00:00.000Z");
    const limited = assetHandlers(testDeps(t.db, { now: () => fixed }), storage);
    let last = 0;
    for (let i = 0; i < 61; i++) last = (await call(limited.requestUpload, { method: "POST", as: bob, body: { kind: "photo", mime: "image/png", bytes: 8 } })).status;
    expect(last).toBe(429);
  });

  it("answers 503 when storage isn't configured", async () => {
    const alice = await createUser(t.db);
    const res = await call(assetHandlers(testDeps(t.db), null).requestUpload, { method: "POST", as: alice, body: { kind: "photo", mime: "image/png", bytes: 8 } });
    expect(res.status).toBe(503);
  });
});

describe("POST /api/assets/:id/complete", () => {
  it("marks a genuine upload ready and is idempotent", async () => {
    const alice = await createUser(t.db);
    const { body } = await requestUpload(alice);
    storage.put("private", stagingOf(alice.id, body.asset.id), file(64));
    const first = await complete(alice, body.asset.id);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ id: body.asset.id, status: "ready", width: 1200, height: 900 });
    expect((await complete(alice, body.asset.id)).body.status).toBe("ready");
  });

  it("answers 409 before the file has been uploaded, leaving the asset pending", async () => {
    const alice = await createUser(t.db);
    const { body } = await requestUpload(alice);
    expect((await complete(alice, body.asset.id)).status).toBe(409);
    const [row] = await t.db.select().from(assets).where(eq(assets.id, body.asset.id));
    expect(row?.status).toBe("pending");
  });

  it("rejects a size mismatch and removes both the row and the object", async () => {
    const alice = await createUser(t.db);
    const { body } = await requestUpload(alice);
    storage.put("private", stagingOf(alice.id, body.asset.id), file(65));
    expect((await complete(alice, body.asset.id)).status).toBe(422);
    expect(await t.db.select().from(assets).where(eq(assets.id, body.asset.id))).toEqual([]);
    expect(storage.has("private", finalOf(alice.id, body.asset.id))).toBe(false);
  });

  it.each([
    ["SVG disguised as PNG", "image/png", Array.from(new TextEncoder().encode("<svg onload=alert(1)>"))],
    ["HTML disguised as JPEG", "image/jpeg", Array.from(new TextEncoder().encode("<!doctype html>"))],
    ["a real PNG declared as JPEG", "image/jpeg", PNG_SIG],
  ])("rejects %s", async (_name, mime, signature) => {
    const alice = await createUser(t.db);
    const { body } = await requestUpload(alice, { kind: "photo", mime, bytes: 64 });
    storage.put("private", stagingOf(alice.id, body.asset.id), file(64, signature));
    expect((await complete(alice, body.asset.id)).status).toBe(422);
    expect(await t.db.select().from(assets).where(eq(assets.id, body.asset.id))).toEqual([]);
    expect(storage.has("private", finalOf(alice.id, body.asset.id))).toBe(false);
  });

  it("queues the object for deletion when storage refuses to remove a rejected file", async () => {
    const alice = await createUser(t.db);
    const { body } = await requestUpload(alice);
    const key = finalOf(alice.id, body.asset.id);
    storage.put("private", stagingOf(alice.id, body.asset.id), file(64, [0x3c, 0x73, 0x76, 0x67]));
    storage.failRemove.add(key);
    expect((await complete(alice, body.asset.id)).status).toBe(422);
    const queued = await t.db.select().from(storageDeletions).where(eq(storageDeletions.storageKey, key));
    expect(queued).toMatchObject([{ bucket: "private", storageKey: key, ownerId: alice.id, bytes: 64, attempts: 1 }]);
  });

  it("answers 404 for someone else's asset and for malformed ids", async () => {
    const alice = await createUser(t.db);
    const bob = await createUser(t.db);
    const { body } = await requestUpload(alice);
    storage.put("private", stagingOf(alice.id, body.asset.id), file(64));
    expect((await complete(bob, body.asset.id)).status).toBe(404);
    expect((await complete(alice, "not-a-uuid")).status).toBe(404);
  });

  it("verifies a server-side copy, so a stale upload URL can't replace a verified photo", async () => {
    const alice = await createUser(t.db);
    const { body } = await requestUpload(alice);
    storage.put("private", stagingOf(alice.id, body.asset.id), file(64));
    expect((await complete(alice, body.asset.id)).status).toBe(200);
    // The upload URL is still valid for a few minutes: overwrite the staging object and complete again.
    storage.put("private", stagingOf(alice.id, body.asset.id), file(64, Array.from(new TextEncoder().encode("<svg onload=alert(1)>"))));
    expect((await complete(alice, body.asset.id)).body.status).toBe("ready");
    const stored = storage.objects.get(`private:${finalOf(alice.id, body.asset.id)}`);
    expect(Array.from(stored!.slice(0, 8))).toEqual(PNG_SIG);
  });

  it("answers 404 and removes its copy when the asset is deleted while it completes", async () => {
    const alice = await createUser(t.db);
    const { body } = await requestUpload(alice);
    storage.put("private", stagingOf(alice.id, body.asset.id), file(64));
    const racing = {
      ...storage,
      copy: async (bucket: "private" | "public", from: string, to: string) => {
        await storage.copy(bucket, from, to);
        await t.db.delete(assets).where(eq(assets.id, body.asset.id));
      },
    };
    const res = await call(assetHandlers(testDeps(t.db), racing).complete, { method: "POST", as: alice, params: { id: body.asset.id }, body: { width: 10, height: 10 } });
    expect(res.status).toBe(404);
    expect(storage.has("private", finalOf(alice.id, body.asset.id))).toBe(false);
    expect(await t.db.select().from(storageDeletions).where(eq(storageDeletions.storageKey, finalOf(alice.id, body.asset.id)))).toEqual([]);
  });

  it.each([{ width: 0, height: 10 }, { width: 10, height: 16_385 }, { width: 10 }, { width: 10, height: 10, status: "ready" }])("rejects dimensions %j with 400", async (dims) => {
    const alice = await createUser(t.db);
    const { body } = await requestUpload(alice);
    expect((await call(h.complete, { method: "POST", as: alice, params: { id: body.asset.id }, body: dims })).status).toBe(400);
  });
});

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../../tests/support/db";
import { testDeps } from "../../../tests/support/deps";
import { docWithPhoto, emptyDoc } from "../../../tests/support/docs";
import { createAsset, createDesign, createUser } from "../../../tests/support/factories";
import { call } from "../../../tests/support/invoke";
import { memoryStorage } from "../../../tests/support/storage";
import { assetHandlers } from "../assets/handlers";
import { UPLOAD_LIMITS } from "../assets/service";
import { assets, designs, storageDeletions } from "../db/schema";
import { designHandlers } from "../designs/handlers";
import { shareHandlers } from "./handlers";

let t: TestDb;
let storage: ReturnType<typeof memoryStorage>;
let h: ReturnType<typeof shareHandlers>;
beforeAll(async () => {
  t = await createTestDb();
  storage = memoryStorage();
  h = shareHandlers(testDeps(t.db), storage);
});
afterAll(() => t.close());

async function sharedWithPhoto() {
  const owner = await createUser(t.db);
  const photo = await createAsset(t.db, { ownerId: owner.id });
  storage.put("private", photo.storageKey, new Uint8Array(photo.bytes));
  const design = await createDesign(t.db, owner.id, docWithPhoto(photo.id));
  const { body } = await call(h.create, { method: "POST", as: owner, params: { id: design.id } });
  return { owner, photo, design, token: body.token as string, linkId: body.id as string };
}
const remix = (as: { id: string } | null, token: string, handlers = h) => call(handlers.remix, { method: "POST", as, path: `/api/shared/${token}/remix`, params: { token } });

describe("POST /api/shared/:token/remix", () => {
  it("gives the remixer their own design with copies of the sharer's photos", async () => {
    const { owner, photo, design, token } = await sharedWithPhoto();
    const bob = await createUser(t.db);
    const res = await remix(bob, token);
    expect(res.status).toBe(201);
    expect(res.body.title).toBe(`Remix of ${design.title}`);
    const copyId = res.body.doc.nodes.photo1.content.assetId;
    expect(copyId).not.toBe(photo.id);
    const [copy] = await t.db.select().from(assets).where(eq(assets.id, copyId));
    expect(copy).toMatchObject({ ownerId: bob.id, visibility: "private", status: "ready", kind: "photo", storageKey: `u/${bob.id}/${copyId}` });
    expect(storage.has("private", copy!.storageKey)).toBe(true);

    expect((await call(assetHandlers(testDeps(t.db), storage).remove, { method: "DELETE", as: owner, params: { id: photo.id } })).status).toBe(204);
    expect(storage.has("private", copy!.storageKey)).toBe(true);
    const saved = await call(designHandlers(testDeps(t.db)).save, { method: "PUT", as: bob, params: { id: res.body.id }, body: { doc: res.body.doc, version: 1 } });
    expect(saved.status).toBe(200);
  });

  it("counts the copies toward the remixer's quota, copying nothing when it's full", async () => {
    const { token, photo } = await sharedWithPhoto();
    const bob = await createUser(t.db);
    await createAsset(t.db, { ownerId: bob.id, bytes: UPLOAD_LIMITS.storageQuotaBytes - photo.bytes + 1 });
    expect((await remix(bob, token)).status).toBe(422);
    expect(await t.db.select().from(designs).where(eq(designs.ownerId, bob.id))).toEqual([]);
    expect([...storage.objects.keys()].some((k) => k.includes(`u/${bob.id}/`))).toBe(false);
  });

  it("turns photos that no longer exist into empty placeholders", async () => {
    const { photo, token } = await sharedWithPhoto();
    await t.db.delete(assets).where(eq(assets.id, photo.id));
    const bob = await createUser(t.db);
    const res = await remix(bob, token);
    expect(res.status).toBe(201);
    expect(res.body.doc.nodes.photo1).toMatchObject({ content: null, placeholder: true });
    expect(res.body.doc.assets).toEqual({});
  });

  it("answers 401 to guests, 410 for revoked links and 404 for unknown ones", async () => {
    const { owner, design, token, linkId } = await sharedWithPhoto();
    const bob = await createUser(t.db);
    expect((await remix(null, token)).status).toBe(401);
    expect((await remix(bob, "C".repeat(22))).status).toBe(404);
    await call(h.revoke, { method: "DELETE", as: owner, params: { id: design.id, linkId } });
    expect((await remix(bob, token)).status).toBe(410);
  });

  it("answers 503 and queues what it copied when storage fails", async () => {
    const { photo, token } = await sharedWithPhoto();
    const bob = await createUser(t.db);
    storage.failCopy.add(photo.storageKey);
    const res = await remix(bob, token);
    storage.failCopy.delete(photo.storageKey);
    expect(res.status).toBe(503);
    expect(await t.db.select().from(designs).where(eq(designs.ownerId, bob.id))).toEqual([]);
    const queued = await t.db.select().from(storageDeletions);
    expect(queued.some((r) => r.storageKey.startsWith(`u/${bob.id}/`))).toBe(true);
  });

  it("remixes a design without photos even when storage isn't configured", async () => {
    const owner = await createUser(t.db);
    const design = await createDesign(t.db, owner.id, emptyDoc());
    const { body } = await call(h.create, { method: "POST", as: owner, params: { id: design.id } });
    const bob = await createUser(t.db);
    expect((await remix(bob, body.token, shareHandlers(testDeps(t.db), null))).status).toBe(201);
  });
});

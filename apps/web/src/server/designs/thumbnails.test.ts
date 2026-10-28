import { createEmptyDoc } from "@vash/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../../tests/support/db";
import { testDeps } from "../../../tests/support/deps";
import { createAsset, createDesign, createUser } from "../../../tests/support/factories";
import { call } from "../../../tests/support/invoke";
import { assets, designs } from "../db/schema";
import { databaseStorage } from "../storage/database";
import { designHandlers } from "./handlers";

let t: TestDb;
let h: ReturnType<typeof designHandlers>;
beforeAll(async () => {
  t = await createTestDb();
  h = designHandlers(testDeps(t.db), databaseStorage({ db: t.db, secret: "test-secret-that-is-at-least-32-characters-long", origin: "http://localhost:3000", now: () => new Date() }));
});
afterAll(() => t.close());

const doc = () => createEmptyDoc({ id: "d", kind: "design", title: "Card", format: "custom", size: { width: 100, height: 100 } });
const thumb = (ownerId: string) => createAsset(t.db, { ownerId, kind: "thumbnail", mime: "image/webp" });
const put = (as: { id: string }, id: string, assetId: string) => call(h.setThumbnail, { method: "PUT", as, params: { id }, body: { assetId } });
const thumbnailOf = async (id: string) => (await t.db.select({ v: designs.thumbnailAssetId }).from(designs).where(eq(designs.id, id)))[0]?.v ?? null;
const exists = async (id: string) => (await t.db.select({ id: assets.id }).from(assets).where(eq(assets.id, id))).length > 0;

describe("PUT /api/designs/:id/thumbnail", () => {
  it("sets the thumbnail and removes the one it replaces, without reordering the list", async () => {
    const alice = await createUser(t.db);
    const design = await createDesign(t.db, alice.id, doc());
    const first = await thumb(alice.id);
    const second = await thumb(alice.id);
    expect((await put(alice, design.id, first.id)).status).toBe(204);
    expect(await thumbnailOf(design.id)).toBe(first.id);
    expect((await put(alice, design.id, second.id)).status).toBe(204);
    expect(await thumbnailOf(design.id)).toBe(second.id);
    expect(await exists(first.id)).toBe(false);
    const [row] = await t.db.select({ updatedAt: designs.updatedAt }).from(designs).where(eq(designs.id, design.id));
    expect(row!.updatedAt).toEqual(design.updatedAt);
  });

  it("only takes your own ready thumbnails, for your own designs", async () => {
    const alice = await createUser(t.db);
    const bob = await createUser(t.db);
    const design = await createDesign(t.db, alice.id, doc());
    const photo = await createAsset(t.db, { ownerId: alice.id });
    const pending = await createAsset(t.db, { ownerId: alice.id, kind: "thumbnail", status: "pending" });
    const bobs = await thumb(bob.id);
    expect((await put(alice, design.id, photo.id)).status).toBe(422);
    expect((await put(alice, design.id, pending.id)).status).toBe(422);
    expect((await put(alice, design.id, bobs.id)).status).toBe(422);
    expect((await put(bob, design.id, bobs.id)).status).toBe(404);
    expect(await thumbnailOf(design.id)).toBeNull();
  });

  it("keeps a thumbnail another design still shows (a duplicate shares it)", async () => {
    const alice = await createUser(t.db);
    const shared = await thumb(alice.id);
    const a = await createDesign(t.db, alice.id, doc(), { thumbnailAssetId: shared.id });
    const b = await createDesign(t.db, alice.id, doc(), { thumbnailAssetId: shared.id });
    expect((await put(alice, a.id, (await thumb(alice.id)).id)).status).toBe(204);
    expect(await exists(shared.id)).toBe(true);
    expect(await thumbnailOf(b.id)).toBe(shared.id);
  });
});

describe("DELETE /api/designs/:id", () => {
  it("removes the design's thumbnail too", async () => {
    const alice = await createUser(t.db);
    const own = await thumb(alice.id);
    const design = await createDesign(t.db, alice.id, doc(), { thumbnailAssetId: own.id });
    expect((await call(h.remove, { method: "DELETE", as: alice, params: { id: design.id } })).status).toBe(204);
    expect(await exists(own.id)).toBe(false);
  });
});

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../../tests/support/db";
import { testDeps } from "../../../tests/support/deps";
import { docWithPhoto, emptyDoc } from "../../../tests/support/docs";
import { createAsset, createUser } from "../../../tests/support/factories";
import { call } from "../../../tests/support/invoke";
import { assets, designVersions, designs } from "../db/schema";
import { runAsUser } from "../db/user-scope";
import { deleteAccount } from "../me/service";
import { designHandlers } from "./handlers";
import { createDesign, getVersion, listVersions, MAX_VERSIONS, restoreVersion, saveDesignDoc } from "./service";

let t: TestDb;
let clock: Date;
const ctx = () => ({ db: t.db, now: () => new Date(clock) });
const handlers = () => designHandlers(testDeps(t.db, { now: () => new Date(clock) }));
const advanceMinutes = (minutes: number) => {
  clock = new Date(clock.getTime() + minutes * 60_000);
};

beforeAll(async () => {
  t = await createTestDb();
});
beforeEach(() => {
  clock = new Date("2026-10-09T10:00:00.000Z");
});
afterAll(() => t.close());

const save = (ownerId: string, id: string, title: string, version: number, checkpoint?: boolean) =>
  saveDesignDoc(ctx(), ownerId, id, { doc: emptyDoc(title), version, checkpoint });

const versionCount = (designId: string) => t.db.$count(designVersions, eq(designVersions.designId, designId));

describe("when a version is kept", () => {
  it("keeps the replaced content when no version exists yet", async () => {
    const alice = await createUser(t.db);
    const { design } = await createDesign(ctx(), alice.id, { doc: emptyDoc("First") });
    await save(alice.id, design.id, "Second", 1);
    const [kept] = await listVersions(ctx(), alice.id, design.id);
    expect(kept).toMatchObject({ version: 1, title: "First" });
    const full = await getVersion(ctx(), alice.id, design.id, kept!.id);
    expect(full.doc.meta.title).toBe("First");
  });

  it("skips saves within 10 minutes of the newest version, and keeps one once it is older", async () => {
    const alice = await createUser(t.db);
    const { design } = await createDesign(ctx(), alice.id, { doc: emptyDoc("v1") });
    await save(alice.id, design.id, "v2", 1); // keeps v1
    advanceMinutes(5);
    await save(alice.id, design.id, "v3", 2); // 5 minutes after the kept one: not kept
    expect(await versionCount(design.id)).toBe(1);
    advanceMinutes(6); // 11 minutes after the kept one
    await save(alice.id, design.id, "v4", 3);
    expect(await versionCount(design.id)).toBe(2);
  });

  it("always keeps the replaced content on a checkpoint save, however recent", async () => {
    const alice = await createUser(t.db);
    const { design } = await createDesign(ctx(), alice.id, { doc: emptyDoc("v1") });
    await save(alice.id, design.id, "v2", 1, true);
    await save(alice.id, design.id, "v3", 2, true);
    expect(await versionCount(design.id)).toBe(2);
  });

  it("keeps the newest 30 and deletes the oldest", async () => {
    const alice = await createUser(t.db);
    const { design } = await createDesign(ctx(), alice.id, { doc: emptyDoc("v1") });
    const saves = MAX_VERSIONS + 5;
    for (let i = 1; i <= saves; i++) {
      advanceMinutes(0.02); // 1.2 seconds apart, so every kept version has its own time
      await save(alice.id, design.id, `v${i + 1}`, i, true);
    }
    const kept = await listVersions(ctx(), alice.id, design.id);
    expect(kept).toHaveLength(MAX_VERSIONS);
    expect(kept.map((v) => v.version)).toEqual(Array.from({ length: MAX_VERSIONS }, (_, i) => saves - i));
  });

  it("refuses a stale save with 409 before it keeps anything", async () => {
    const alice = await createUser(t.db);
    const { design } = await createDesign(ctx(), alice.id, { doc: emptyDoc("v1") });
    await save(alice.id, design.id, "v2", 1, true);
    await expect(save(alice.id, design.id, "stale", 1, true)).rejects.toMatchObject({ status: 409, extra: { currentVersion: 2 } });
    expect(await versionCount(design.id)).toBe(1);
  });
});

describe("restore", () => {
  it("keeps the current content, replaces the design with the version and bumps the version", async () => {
    const alice = await createUser(t.db);
    const { design } = await createDesign(ctx(), alice.id, { doc: emptyDoc("Original") });
    await save(alice.id, design.id, "Edited", 1, true);
    const original = (await listVersions(ctx(), alice.id, design.id)).find((v) => v.title === "Original");
    const restored = await restoreVersion(ctx(), alice.id, design.id, original!.id, 2);
    expect(restored).toMatchObject({ version: 3, title: "Original" });
    expect(restored.doc.meta.title).toBe("Original");
    const kept = await listVersions(ctx(), alice.id, design.id);
    expect(kept.map((v) => [v.version, v.title])).toEqual([
      [2, "Edited"],
      [1, "Original"],
    ]);
  });

  it("answers 409 with the current version when the design changed since it was loaded", async () => {
    const alice = await createUser(t.db);
    const { design } = await createDesign(ctx(), alice.id, { doc: emptyDoc("Original") });
    await save(alice.id, design.id, "Edited", 1);
    const [original] = await listVersions(ctx(), alice.id, design.id);
    await expect(restoreVersion(ctx(), alice.id, design.id, original!.id, 1)).rejects.toMatchObject({ status: 409, extra: { currentVersion: 2 } });
    expect(await versionCount(design.id)).toBe(1);
  });

  it("refuses a version whose photos were deleted since, with 422", async () => {
    const alice = await createUser(t.db);
    const photo = await createAsset(t.db, { ownerId: alice.id });
    const { design } = await createDesign(ctx(), alice.id, { doc: docWithPhoto(photo.id) });
    await save(alice.id, design.id, "Plain", 1, true);
    await t.db.delete(assets).where(eq(assets.id, photo.id));
    const [withPhoto] = await listVersions(ctx(), alice.id, design.id);
    await expect(restoreVersion(ctx(), alice.id, design.id, withPhoto!.id, 2)).rejects.toMatchObject({ status: 422 });
  });

  it("lets exactly one of two concurrent restores of the same version win", async () => {
    const alice = await createUser(t.db);
    const { design } = await createDesign(ctx(), alice.id, { doc: emptyDoc("Original") });
    await save(alice.id, design.id, "Edited", 1);
    const [original] = await listVersions(ctx(), alice.id, design.id);
    const results = await Promise.allSettled([
      restoreVersion(ctx(), alice.id, design.id, original!.id, 2),
      restoreVersion(ctx(), alice.id, design.id, original!.id, 2),
    ]);
    const statuses = results.map((r) => (r.status === "fulfilled" ? 200 : (r.reason as { status: number }).status));
    expect(statuses.sort()).toEqual([200, 409]);
  });
});

describe("owner scoping and HTTP", () => {
  it("answers 404 for another owner's design on list, get and restore", async () => {
    const alice = await createUser(t.db);
    const bob = await createUser(t.db);
    const { design } = await createDesign(ctx(), alice.id, { doc: emptyDoc("v1") });
    await save(alice.id, design.id, "v2", 1, true);
    const [version] = await listVersions(ctx(), alice.id, design.id);
    const h = handlers();

    expect((await call(h.listVersions, { as: bob, params: { id: design.id } })).status).toBe(404);
    expect((await call(h.getVersion, { as: bob, params: { id: design.id, versionId: version!.id } })).status).toBe(404);
    expect((await call(h.restoreVersion, { method: "POST", as: bob, params: { id: design.id, versionId: version!.id }, body: { version: 2 } })).status).toBe(404);
    // Bob's own design, but Alice's version id: still not found.
    const bobs = await createDesign(ctx(), bob.id, { doc: emptyDoc("Bob") });
    expect((await call(h.getVersion, { as: bob, params: { id: bobs.design.id, versionId: version!.id } })).status).toBe(404);
    // Row-level security also hides the versions from anyone but the owner.
    expect(await runAsUser(bob.id, () => t.db.select().from(designVersions))).toEqual([]);
  });

  it("lists versions without documents, newest first, and returns one version's document", async () => {
    const alice = await createUser(t.db);
    const { design } = await createDesign(ctx(), alice.id, { doc: emptyDoc("v1") });
    await save(alice.id, design.id, "v2", 1, true);
    await save(alice.id, design.id, "v3", 2, true);
    const h = handlers();
    const list = await call(h.listVersions, { as: alice, params: { id: design.id } });
    expect(list.status).toBe(200);
    expect(list.body.map((v: { version: number }) => v.version)).toEqual([2, 1]);
    expect(list.body[0]).toEqual({ id: expect.any(String), version: 2, title: "v2", createdAt: expect.any(String) });
    const one = await call(h.getVersion, { as: alice, params: { id: design.id, versionId: list.body[1].id } });
    expect(one.body).toMatchObject({ version: 1, title: "v1", designId: design.id, doc: { meta: { title: "v1" } } });
  });

  it("restores over HTTP and answers 409 for a stale version number", async () => {
    const alice = await createUser(t.db);
    const { design } = await createDesign(ctx(), alice.id, { doc: emptyDoc("v1") });
    await save(alice.id, design.id, "v2", 1, true);
    const [version] = await listVersions(ctx(), alice.id, design.id);
    const params = { id: design.id, versionId: version!.id };
    const h = handlers();
    expect((await call(h.restoreVersion, { method: "POST", as: alice, params, body: { version: 1 } })).status).toBe(409);
    const ok = await call(h.restoreVersion, { method: "POST", as: alice, params, body: { version: 2 } });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ version: 3, title: "v1" });
  });

  it("accepts a boolean checkpoint on save and rejects anything else", async () => {
    const alice = await createUser(t.db);
    const { design } = await createDesign(ctx(), alice.id, { doc: emptyDoc("v1") });
    const h = handlers();
    const bad = await call(h.save, { method: "PUT", as: alice, params: { id: design.id }, body: { doc: emptyDoc("v2"), version: 1, checkpoint: "yes" } });
    expect(bad.status).toBe(400);
    const good = await call(h.save, { method: "PUT", as: alice, params: { id: design.id }, body: { doc: emptyDoc("v2"), version: 1, checkpoint: true } });
    expect(good.status).toBe(200);
    expect(await versionCount(design.id)).toBe(1);
  });

  it("answers 404 for malformed version and design ids", async () => {
    const alice = await createUser(t.db);
    const { design } = await createDesign(ctx(), alice.id, { doc: emptyDoc("v1") });
    const h = handlers();
    expect((await call(h.getVersion, { as: alice, params: { id: design.id, versionId: "nope" } })).status).toBe(404);
    expect((await call(h.listVersions, { as: alice, params: { id: randomUUID() } })).status).toBe(404);
  });
});

describe("removal", () => {
  it("deletes a design's versions with the design", async () => {
    const alice = await createUser(t.db);
    const { design } = await createDesign(ctx(), alice.id, { doc: emptyDoc("v1") });
    await save(alice.id, design.id, "v2", 1, true);
    expect(await versionCount(design.id)).toBe(1);
    expect((await call(handlers().remove, { method: "DELETE", as: alice, params: { id: design.id } })).status).toBe(204);
    expect(await versionCount(design.id)).toBe(0);
  });

  it("deletes every version when the account is deleted", async () => {
    const alice = await createUser(t.db);
    const { design } = await createDesign(ctx(), alice.id, { doc: emptyDoc("v1") });
    await save(alice.id, design.id, "v2", 1, true);
    await deleteAccount(t.db, alice.id, new Date(clock));
    expect(await t.db.select().from(designVersions).where(eq(designVersions.ownerId, alice.id))).toEqual([]);
    expect(await t.db.select().from(designs).where(eq(designs.ownerId, alice.id))).toEqual([]);
  });
});

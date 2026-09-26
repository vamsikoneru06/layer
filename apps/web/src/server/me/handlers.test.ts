import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../../tests/support/db";
import { testDeps } from "../../../tests/support/deps";
import { emptyDoc } from "../../../tests/support/docs";
import { createAsset, createFolder, createUser } from "../../../tests/support/factories";
import { call } from "../../../tests/support/invoke";
import { auditLog, designs, folders, storageDeletions, user } from "../db/schema";
import { meHandlers } from "./handlers";

let t: TestDb;
let h: ReturnType<typeof meHandlers>;
beforeAll(async () => {
  t = await createTestDb();
  h = meHandlers(testDeps(t.db));
});
afterAll(() => t.close());

describe("GET /api/me", () => {
  it("returns the caller's profile and requires sign-in", async () => {
    const alice = await createUser(t.db, { name: "Alice" });
    expect((await call(h.get, { as: alice })).body).toMatchObject({ id: alice.id, email: alice.email, name: "Alice", role: "user", handle: null, interests: [] });
    expect((await call(h.get)).status).toBe(401);
  });
});

describe("PATCH /api/me", () => {
  it("sets a normalised handle and interests", async () => {
    const alice = await createUser(t.db);
    const res = await call(h.patch, { method: "PATCH", as: alice, body: { handle: "Riya_Designs", interests: ["birthday", "birthday", "travel"] } });
    expect(res.body).toMatchObject({ handle: "riya_designs", interests: ["birthday", "travel"] });
  });

  it.each([{ handle: "ab" }, { handle: "has space" }, { handle: "admin" }, { interests: ["not-a-category"] }, { role: "admin" }, { email: "x@y.z" }])(
    "rejects %j with 400",
    async (body) => {
      const alice = await createUser(t.db);
      expect((await call(h.patch, { method: "PATCH", as: alice, body })).status).toBe(400);
      const [row] = await t.db.select().from(user).where(eq(user.id, alice.id));
      expect(row?.role).toBe("user");
    },
  );

  it("answers 409 when the handle is taken", async () => {
    const alice = await createUser(t.db, { handle: "taken_handle" });
    const bob = await createUser(t.db);
    expect(alice.handle).toBe("taken_handle");
    expect((await call(h.patch, { method: "PATCH", as: bob, body: { handle: "taken_handle" } })).status).toBe(409);
  });

  it("finishes onboarding only once a handle exists", async () => {
    const alice = await createUser(t.db);
    expect((await call(h.patch, { method: "PATCH", as: alice, body: { completeOnboarding: true } })).status).toBe(422);
    const done = await call(h.patch, { method: "PATCH", as: alice, body: { handle: "alice_ok", completeOnboarding: true } });
    expect(done.body.onboardedAt).toEqual(expect.any(String));
  });
});

describe("GET /api/me/export", () => {
  it("exports the caller's data as an attachment and nothing of anyone else's", async () => {
    const alice = await createUser(t.db);
    const bob = await createUser(t.db);
    await createFolder(t.db, alice.id, "Alice's folder");
    await createFolder(t.db, bob.id, "Bob's folder");
    await t.db.insert(designs).values({ ownerId: alice.id, title: "Mine", doc: emptyDoc("Mine") });
    const res = await call(h.export, { as: alice });
    expect(res.headers.get("content-disposition")).toMatch(/attachment; filename="vash-export\.json"/);
    expect(res.body.profile.id).toBe(alice.id);
    expect(res.body.folders.map((f: { name: string }) => f.name)).toEqual(["Alice's folder"]);
    expect(res.body.designs[0].doc.meta.title).toBe("Mine");
    expect(JSON.stringify(res.body)).not.toContain("Bob's folder");
  });
});

describe("DELETE /api/me", () => {
  it("deletes the account, queues storage deletions and writes the audit log", async () => {
    const alice = await createUser(t.db);
    const bob = await createUser(t.db);
    await createFolder(t.db, alice.id);
    const privateAsset = await createAsset(t.db, { ownerId: alice.id });
    const publicAsset = await createAsset(t.db, { ownerId: alice.id, visibility: "public" });
    const bobsFolder = await createFolder(t.db, bob.id);

    expect((await call(h.remove, { method: "DELETE", as: alice })).status).toBe(204);

    expect(await t.db.select().from(user).where(eq(user.id, alice.id))).toEqual([]);
    expect(await t.db.select().from(folders).where(eq(folders.ownerId, alice.id))).toEqual([]);
    const queued = await t.db.select().from(storageDeletions);
    expect(queued).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ bucket: "private", storageKey: privateAsset.storageKey }),
        expect.objectContaining({ bucket: "public", storageKey: publicAsset.storageKey }),
      ]),
    );
    const [entry] = await t.db.select().from(auditLog).where(eq(auditLog.targetId, alice.id));
    expect(entry).toMatchObject({ actorId: alice.id, action: "account.delete", targetType: "user", meta: { assets: 2 } });
    expect(await t.db.select().from(folders).where(eq(folders.id, bobsFolder.id))).toHaveLength(1);
  });

  it("requires a same-origin request", async () => {
    const alice = await createUser(t.db);
    expect((await call(h.remove, { method: "DELETE", as: alice, origin: "https://evil.example" })).status).toBe(403);
    expect(await t.db.select().from(user).where(eq(user.id, alice.id))).toHaveLength(1);
  });
});

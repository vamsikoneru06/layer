import { randomUUID } from "node:crypto";
import { createEmptyDoc } from "@vash/schema";
import { eq } from "drizzle-orm";
import { hasLoneSurrogate } from "../text";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../../tests/support/db";
import { testDeps, tickingClock } from "../../../tests/support/deps";
import { docWithPhoto, emptyDoc } from "../../../tests/support/docs";
import { createAsset, createFolder, createUser } from "../../../tests/support/factories";
import { call } from "../../../tests/support/invoke";
import { designs } from "../db/schema";
import { QUOTAS } from "../quotas";
import { RATE_LIMITS } from "../rate-limit/rules";
import { designHandlers } from "./handlers";

let t: TestDb;
let h: ReturnType<typeof designHandlers>;
beforeAll(async () => {
  t = await createTestDb();
  h = designHandlers(testDeps(t.db, { now: tickingClock() }));
});
afterAll(() => t.close());

async function newDesign(owner: { id: string }, doc: unknown = emptyDoc()) {
  const res = await call(h.create, { method: "POST", as: owner, body: { doc } });
  expect(res.status).toBe(201);
  return res.body as { id: string; version: number; title: string; doc: { id: string } };
}

describe("create", () => {
  it("validates the document, stamps its id and takes the title from it", async () => {
    const alice = await createUser(t.db);
    const d = await newDesign(alice);
    expect(d).toMatchObject({ version: 1, title: "Birthday card" });
    expect(d.doc.id).toBe(d.id);
  });

  it("creates under a client-chosen id, and a repeat returns that design instead of making a copy", async () => {
    const alice = await createUser(t.db);
    const id = randomUUID();
    const first = await call(h.create, { method: "POST", as: alice, body: { id, doc: emptyDoc() } });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ id, doc: { id } });
    // A retry after a lost response, even with a changed document, keeps the saved one.
    const again = await call(h.create, { method: "POST", as: alice, body: { id, doc: { ...emptyDoc(), meta: { ...emptyDoc().meta, title: "Changed" } } } });
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ id, version: 1, title: first.body.title });
    expect(await t.db.$count(designs, eq(designs.id, id))).toBe(1);
  });

  it("refuses a client id that another account already uses, without revealing anything", async () => {
    const alice = await createUser(t.db);
    const bob = await createUser(t.db);
    const id = randomUUID();
    expect((await call(h.create, { method: "POST", as: alice, body: { id, doc: emptyDoc() } })).status).toBe(201);
    const res = await call(h.create, { method: "POST", as: bob, body: { id, doc: emptyDoc() } });
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).not.toContain(alice.id);
    expect(await t.db.$count(designs, eq(designs.ownerId, bob.id))).toBe(0);
  });

  it("rejects an invalid document with 422 and issues", async () => {
    const alice = await createUser(t.db);
    const res = await call(h.create, { method: "POST", as: alice, body: { doc: { ...emptyDoc(), root: ["ghost"] } } });
    expect(res.status).toBe(422);
    expect(res.body.issues.length).toBeGreaterThan(0);
  });

  it("accepts own ready photos and system assets; rejects pending, foreign-private and wrong-kind assets", async () => {
    const alice = await createUser(t.db);
    const bob = await createUser(t.db);
    const own = await createAsset(t.db, { ownerId: alice.id });
    const system = await createAsset(t.db, { ownerId: null });
    const pending = await createAsset(t.db, { ownerId: alice.id, status: "pending" });
    const bobs = await createAsset(t.db, { ownerId: bob.id });
    const thumb = await createAsset(t.db, { ownerId: alice.id, kind: "thumbnail" });

    for (const ok of [own, system]) expect((await call(h.create, { method: "POST", as: alice, body: { doc: docWithPhoto(ok.id) } })).status).toBe(201);
    for (const bad of [pending, bobs, thumb]) {
      const res = await call(h.create, { method: "POST", as: alice, body: { doc: docWithPhoto(bad.id) } });
      expect(res.status).toBe(422);
      expect(res.body.assetIds).toEqual([bad.id]);
    }
  });

  it("only files designs into the caller's own folders", async () => {
    const alice = await createUser(t.db);
    const bob = await createUser(t.db);
    const bobsFolder = await createFolder(t.db, bob.id);
    expect((await call(h.create, { method: "POST", as: alice, body: { doc: emptyDoc(), folderId: bobsFolder.id } })).status).toBe(422);
  });

  it("rejects mass-assignment fields", async () => {
    const alice = await createUser(t.db);
    // `id` is allowed (owner-scoped, see "creates under a client-chosen id"), but must be a uuid.
    for (const extra of [{ ownerId: "x" }, { version: 9 }, { id: "not-a-uuid" }]) {
      expect((await call(h.create, { method: "POST", as: alice, body: { doc: emptyDoc(), ...extra } })).status).toBe(400);
    }
  });
});

describe("read and list", () => {
  it("lists the caller's designs newest first without documents, filtered by folder", async () => {
    const alice = await createUser(t.db);
    const bob = await createUser(t.db);
    const folder = await createFolder(t.db, alice.id);
    const first = await newDesign(alice);
    const second = await newDesign(alice);
    await call(h.create, { method: "POST", as: alice, body: { doc: emptyDoc(), folderId: folder.id } });
    await newDesign(bob);

    const all = await call(h.list, { as: alice, path: "/api/designs?limit=2" });
    expect(all.body.items).toHaveLength(2);
    expect(all.body.items[0].doc).toBeUndefined();
    const rest = await call(h.list, { as: alice, path: `/api/designs?limit=2&cursor=${all.body.nextCursor}` });
    const ids = [...all.body.items, ...rest.body.items].map((d: { id: string }) => d.id);
    expect(ids).toHaveLength(3);
    expect(ids.indexOf(second.id)).toBeLessThan(ids.indexOf(first.id));

    const filed = await call(h.list, { as: alice, path: `/api/designs?folderId=${folder.id}` });
    expect(filed.body.items).toHaveLength(1);
  });

  it("lists each design's format and artboard size for cards", async () => {
    const alice = await createUser(t.db);
    const story = createEmptyDoc({ id: "draft", kind: "design", title: "Story", format: "ig-story" });
    await newDesign(alice, story);
    const res = await call(h.list, { as: alice, path: "/api/designs" });
    expect(res.body.items[0]).toMatchObject({ format: "ig-story", width: 1080, height: 1920 });
  });

  it("returns 404 for someone else's design and for malformed ids", async () => {
    const alice = await createUser(t.db);
    const bob = await createUser(t.db);
    const d = await newDesign(alice);
    expect((await call(h.get, { as: alice, params: { id: d.id } })).body.doc.id).toBe(d.id);
    expect((await call(h.get, { as: bob, params: { id: d.id } })).status).toBe(404);
    expect((await call(h.get, { as: alice, params: { id: "nope" } })).status).toBe(404);
  });
});

describe("autosave (PUT)", () => {
  it("saves with the current version and bumps it", async () => {
    const alice = await createUser(t.db);
    const d = await newDesign(alice);
    const res = await call(h.save, { method: "PUT", as: alice, params: { id: d.id }, body: { doc: emptyDoc("Renamed in editor"), version: 1 } });
    expect(res.body).toMatchObject({ version: 2, title: "Renamed in editor", doc: { meta: { title: "Renamed in editor" } } });
  });

  it("leaves the document out of the answer when the client prefers a minimal one", async () => {
    const alice = await createUser(t.db);
    const d = await newDesign(alice);
    const res = await call(h.save, { method: "PUT", as: alice, params: { id: d.id }, headers: { prefer: "return=minimal" }, body: { doc: emptyDoc("Quick"), version: 1 } });
    expect(res.status).toBe(200);
    expect(res.headers.get("preference-applied")).toBe("return=minimal");
    expect(res.body).toMatchObject({ id: d.id, version: 2, title: "Quick" });
    expect(res.body).not.toHaveProperty("doc");
    const stored = await call(h.get, { as: alice, params: { id: d.id } });
    expect(stored.body.doc.meta.title).toBe("Quick");
  });

  it("returns 404 for a missing design even when the document is invalid", async () => {
    const alice = await createUser(t.db);
    const missing = "6f1c2b7e-0000-4000-8000-000000000000";
    expect((await call(h.save, { method: "PUT", as: alice, params: { id: missing }, body: { doc: {}, version: 1 } })).status).toBe(404);
    expect((await call(h.save, { method: "PUT", as: alice, params: { id: missing }, body: { doc: emptyDoc(), version: 1 } })).status).toBe(404);
  });

  it("answers 409 with the current version when stale", async () => {
    const alice = await createUser(t.db);
    const d = await newDesign(alice);
    await call(h.save, { method: "PUT", as: alice, params: { id: d.id }, body: { doc: emptyDoc(), version: 1 } });
    const stale = await call(h.save, { method: "PUT", as: alice, params: { id: d.id }, body: { doc: emptyDoc(), version: 1 } });
    expect(stale.status).toBe(409);
    expect(stale.body.currentVersion).toBe(2);
  });

  it("lets exactly one of two concurrent saves of the same version win", async () => {
    const alice = await createUser(t.db);
    const d = await newDesign(alice);
    const save = () => call(h.save, { method: "PUT", as: alice, params: { id: d.id }, body: { doc: emptyDoc(), version: 1 } });
    const statuses = (await Promise.all([save(), save()])).map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409]);
  });

  it("returns 404 (not 409 or 422) for someone else's design", async () => {
    const alice = await createUser(t.db);
    const bob = await createUser(t.db);
    const d = await newDesign(alice);
    expect((await call(h.save, { method: "PUT", as: bob, params: { id: d.id }, body: { doc: emptyDoc(), version: 1 } })).status).toBe(404);
    expect((await call(h.save, { method: "PUT", as: bob, params: { id: d.id }, body: { doc: {}, version: 1 } })).status).toBe(404);
  });

  it("rejects bodies over the document size limit with 413", async () => {
    const alice = await createUser(t.db);
    const d = await newDesign(alice);
    const huge = JSON.stringify({ doc: { pad: "x".repeat(1_100_000) }, version: 1 });
    expect((await call(h.save, { method: "PUT", as: alice, params: { id: d.id }, rawBody: huge, headers: { "content-type": "application/json" } })).status).toBe(413);
  });

  it("rate-limits saves to 120 per minute per user", async () => {
    const carol = await createUser(t.db);
    const fixed = new Date("2026-09-25T10:00:30.000Z");
    const limited = designHandlers(testDeps(t.db, { now: () => fixed }));
    const d = await newDesign(carol);
    let last = 0;
    for (let i = 0; i < 121; i++) last = (await call(limited.save, { method: "PUT", as: carol, params: { id: d.id }, body: { doc: emptyDoc(), version: 1 + i } })).status;
    expect(last).toBe(429);
  });
});

describe("metadata, delete, duplicate", () => {
  it("renames by rewriting doc.meta.title and bumping the version", async () => {
    const alice = await createUser(t.db);
    const d = await newDesign(alice);
    const res = await call(h.patch, { method: "PATCH", as: alice, params: { id: d.id }, body: { title: "Diwali" } });
    expect(res.body).toMatchObject({ title: "Diwali", version: 2 });
    expect((await call(h.get, { as: alice, params: { id: d.id } })).body.doc.meta.title).toBe("Diwali");
  });

  it("rejects empty or unknown patch fields", async () => {
    const alice = await createUser(t.db);
    const d = await newDesign(alice);
    expect((await call(h.patch, { method: "PATCH", as: alice, params: { id: d.id }, body: {} })).status).toBe(400);
    expect((await call(h.patch, { method: "PATCH", as: alice, params: { id: d.id }, body: { version: 7 } })).status).toBe(400);
  });

  it("moves between the caller's folders only", async () => {
    const alice = await createUser(t.db);
    const bob = await createUser(t.db);
    const d = await newDesign(alice);
    const mine = await createFolder(t.db, alice.id);
    const his = await createFolder(t.db, bob.id);
    expect((await call(h.patch, { method: "PATCH", as: alice, params: { id: d.id }, body: { folderId: mine.id } })).body.folderId).toBe(mine.id);
    expect((await call(h.patch, { method: "PATCH", as: alice, params: { id: d.id }, body: { folderId: his.id } })).status).toBe(422);
    expect((await call(h.patch, { method: "PATCH", as: alice, params: { id: d.id }, body: { folderId: null } })).body.folderId).toBeNull();
  });

  it("deletes and duplicates only the caller's designs", async () => {
    const alice = await createUser(t.db);
    const bob = await createUser(t.db);
    const d = await newDesign(alice);

    expect((await call(h.duplicate, { method: "POST", as: bob, params: { id: d.id } })).status).toBe(404);
    const copy = await call(h.duplicate, { method: "POST", as: alice, params: { id: d.id } });
    expect(copy.status).toBe(201);
    expect(copy.body).toMatchObject({ title: "Copy of Birthday card", version: 1 });
    expect(copy.body.id).not.toBe(d.id);
    expect(copy.body.doc.id).toBe(copy.body.id);

    expect((await call(h.remove, { method: "DELETE", as: bob, params: { id: d.id } })).status).toBe(404);
    expect((await call(h.remove, { method: "DELETE", as: alice, params: { id: d.id } })).status).toBe(204);
    expect((await call(h.get, { as: alice, params: { id: d.id } })).status).toBe(404);
  });
});

describe("quota and create rate limit", () => {
  it("duplicates a design whose long title ends in an emoji", async () => {
    const alice = await createUser(t.db);
    const created = await call(h.create, { method: "POST", as: alice, body: { doc: emptyDoc("a".repeat(111) + "😀") } });
    const copy = await call(h.duplicate, { method: "POST", as: alice, params: { id: created.body.id } });
    expect(copy.status).toBe(201);
    expect(copy.body.title).not.toSatisfy(hasLoneSurrogate);
  });

  it("caps each user at QUOTAS.designs, counting duplicates, with 422", async () => {
    const dave = await createUser(t.db);
    const erin = await createUser(t.db);
    await t.db.insert(designs).values(Array.from({ length: QUOTAS.designs - 1 }, () => ({ ownerId: dave.id, title: "x", doc: emptyDoc() })));
    const last = await newDesign(dave);
    const over = await call(h.create, { method: "POST", as: dave, body: { doc: emptyDoc() } });
    expect(over.status).toBe(422);
    expect(over.body.limit).toBe(QUOTAS.designs);
    expect((await call(h.duplicate, { method: "POST", as: dave, params: { id: last.id } })).status).toBe(422);
    await newDesign(erin);
  });

  it("rate-limits create and duplicate together per user", async () => {
    const frank = await createUser(t.db);
    const fixed = new Date("2026-09-25T10:00:30.000Z");
    const limited = designHandlers(testDeps(t.db, { now: () => fixed }));
    const d = (await call(limited.create, { method: "POST", as: frank, body: { doc: emptyDoc() } })).body as { id: string };
    for (let i = 1; i < RATE_LIMITS.designCreate.max; i++) {
      expect((await call(limited.duplicate, { method: "POST", as: frank, params: { id: d.id } })).status).toBe(201);
    }
    const res = await call(limited.create, { method: "POST", as: frank, body: { doc: emptyDoc() } });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toMatch(/^\d+$/);
  });
});

import { createEmptyDoc } from "@vash/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../../tests/support/db";
import { testDeps, tickingClock } from "../../../tests/support/deps";
import { createFolder, createUser } from "../../../tests/support/factories";
import { call } from "../../../tests/support/invoke";
import { designs, folders } from "../db/schema";
import { QUOTAS } from "../quotas";
import { folderHandlers } from "./handlers";

let t: TestDb;
let h: ReturnType<typeof folderHandlers>;
beforeAll(async () => {
  t = await createTestDb();
  h = folderHandlers(testDeps(t.db, { now: tickingClock() }));
});
afterAll(() => t.close());

describe("folders", () => {
  it("creates a folder and never exposes the owner", async () => {
    const alice = await createUser(t.db);
    const res = await call(h.create, { method: "POST", as: alice, body: { name: "  Birthdays  " } });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: expect.any(String), name: "Birthdays", createdAt: expect.any(String), updatedAt: expect.any(String) });
  });

  it.each([{ name: "" }, { name: "x".repeat(81) }, { name: "ok", ownerId: "someone-else" }, {}])("rejects body %j with 400", async (body) => {
    const alice = await createUser(t.db);
    expect((await call(h.create, { method: "POST", as: alice, body })).status).toBe(400);
  });

  it("lists only the caller's folders, paginated oldest first", async () => {
    const alice = await createUser(t.db);
    const bob = await createUser(t.db);
    for (const name of ["A", "B", "C"]) await call(h.create, { method: "POST", as: alice, body: { name } });
    await createFolder(t.db, bob.id, "Bob's");

    const first = await call(h.list, { as: alice, path: "/api/folders?limit=2" });
    expect(first.body.items.map((f: { name: string }) => f.name)).toEqual(["A", "B"]);
    const second = await call(h.list, { as: alice, path: `/api/folders?limit=2&cursor=${first.body.nextCursor}` });
    expect(second.body).toMatchObject({ items: [{ name: "C" }], nextCursor: null });
    expect((await call(h.list, { as: alice, path: "/api/folders?limit=51" })).status).toBe(400);
  });

  it("renames and deletes only the caller's folders (404 for anyone else's)", async () => {
    const alice = await createUser(t.db);
    const bob = await createUser(t.db);
    const folder = await createFolder(t.db, alice.id);
    const params = { id: folder.id };

    expect((await call(h.rename, { method: "PATCH", as: bob, params, body: { name: "Mine now" } })).status).toBe(404);
    expect((await call(h.remove, { method: "DELETE", as: bob, params })).status).toBe(404);
    const [still] = await t.db.select().from(folders).where(eq(folders.id, folder.id));
    expect(still?.name).toBe("Birthdays");

    expect((await call(h.rename, { method: "PATCH", as: alice, params, body: { name: "Weddings" } })).body.name).toBe("Weddings");
    expect((await call(h.remove, { method: "DELETE", as: alice, params })).status).toBe(204);
  });

  it.each(["not-a-uuid", "1'", "00000000-0000-4000-8000-000000000000"])("answers 404 for id %s", async (id) => {
    const alice = await createUser(t.db);
    expect((await call(h.rename, { method: "PATCH", as: alice, params: { id }, body: { name: "x" } })).status).toBe(404);
  });

  it("keeps designs when their folder is deleted", async () => {
    const alice = await createUser(t.db);
    const folder = await createFolder(t.db, alice.id);
    const [design] = await t.db
      .insert(designs)
      .values({ ownerId: alice.id, folderId: folder.id, title: "Card", doc: createEmptyDoc({ id: "d", kind: "design", title: "Card", format: "ig-post" }) })
      .returning();
    await call(h.remove, { method: "DELETE", as: alice, params: { id: folder.id } });
    const [after] = await t.db.select().from(designs).where(eq(designs.id, design!.id));
    expect(after?.folderId).toBeNull();
  });

  it("requires sign-in and a same-origin request", async () => {
    const alice = await createUser(t.db);
    expect((await call(h.list)).status).toBe(401);
    expect((await call(h.create, { method: "POST", as: alice, origin: null, body: { name: "x" } })).status).toBe(403);
  });
});

describe("folder quota", () => {
  it("caps each user at QUOTAS.folders with 422", async () => {
    const alice = await createUser(t.db);
    await t.db.insert(folders).values(Array.from({ length: QUOTAS.folders - 1 }, (_, i) => ({ ownerId: alice.id, name: `F${i}` })));
    expect((await call(h.create, { method: "POST", as: alice, body: { name: "Last" } })).status).toBe(201);
    const over = await call(h.create, { method: "POST", as: alice, body: { name: "One too many" } });
    expect(over.status).toBe(422);
    expect(over.body.limit).toBe(QUOTAS.folders);
  });
});

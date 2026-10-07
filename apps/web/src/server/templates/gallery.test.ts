import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../../tests/support/db";
import { testDeps } from "../../../tests/support/deps";
import { createTemplate, createUser } from "../../../tests/support/factories";
import { call } from "../../../tests/support/invoke";
import { templates } from "../db/schema";
import { templateHandlers } from "./handlers";

let t: TestDb;
let h: ReturnType<typeof templateHandlers>;
beforeAll(async () => {
  t = await createTestDb();
  h = templateHandlers(testDeps(t.db));
});
beforeEach(async () => {
  await t.db.delete(templates);
});
afterAll(() => t.close());

const list = (query = "") => call(h.list, { path: `/api/templates${query}` });
const ids = (res: { body: { items: { id: string }[] } }) => res.body.items.map((i) => i.id);
const handle = () => `u_${randomUUID().slice(0, 8)}`;

describe("GET /api/templates", () => {
  it("lets the CDN cache the public list for a minute", async () => {
    const res = await list();
    expect(res.headers.get("cache-control")).toBe("public, max-age=0, s-maxage=60, stale-while-revalidate=300");
  });

  it("lists published templates newest first, a page at a time", async () => {
    const a = await createTemplate(t.db, { createdAt: new Date("2026-09-01T00:00:00Z") });
    const b = await createTemplate(t.db, { createdAt: new Date("2026-09-02T00:00:00Z") });
    const c = await createTemplate(t.db, { createdAt: new Date("2026-09-03T00:00:00Z") });
    await createTemplate(t.db, { status: "hidden", createdAt: new Date("2026-09-04T00:00:00Z") });
    const first = await list("?sort=new&limit=2");
    expect(first.status).toBe(200);
    expect(ids(first)).toEqual([c.id, b.id]);
    const second = await list(`?sort=new&limit=2&cursor=${first.body.nextCursor}`);
    expect(ids(second)).toEqual([a.id]);
    expect(second.body.nextCursor).toBeNull();
  });

  it("sorts by uses (the default), breaking ties by id, without repeats across pages", async () => {
    const rows = await Promise.all([5, 9, 5, 0].map((usesCount) => createTemplate(t.db, { usesCount })));
    const expected = [...rows].sort((x, y) => y.usesCount - x.usesCount || (x.id < y.id ? 1 : -1)).map((r) => r.id);
    const seen: string[] = [];
    let cursor = "";
    for (let i = 0; i < 5; i++) {
      const res = await list(`?limit=1${cursor ? `&cursor=${cursor}` : ""}`);
      seen.push(...ids(res));
      if (!res.body.nextCursor) break;
      cursor = res.body.nextCursor;
    }
    expect(seen).toEqual(expected);
  });

  it("filters by category, format and featured, and searches titles and tags", async () => {
    const party = await createTemplate(t.db, { title: "Sunset Birthday Bash", tags: ["party"], category: "birthday", format: "ig-post" });
    const menu = await createTemplate(t.db, { title: "Menu", tags: ["food", "dinner"], category: "food", format: "poster", width: 1240, height: 1754, featured: true });
    expect(ids(await list("?category=food"))).toEqual([menu.id]);
    expect(ids(await list("?format=ig-post"))).toEqual([party.id]);
    expect(ids(await list("?sort=featured"))).toEqual([menu.id]);
    expect(ids(await list("?q=birthday"))).toEqual([party.id]);
    expect(ids(await list("?q=DINNER"))).toEqual([menu.id]);
    expect(ids(await list("?q=nothing-like-this"))).toEqual([]);
  });

  it.each(["a & b | !c:*", "'); drop table templates; --", "🎉", "x".repeat(100)])("treats search %j as words, never as query syntax", async (q) => {
    await createTemplate(t.db);
    expect((await list(`?q=${encodeURIComponent(q)}`)).status).toBe(200);
  });

  const cursorOf = (value: unknown[]) => Buffer.from(JSON.stringify(value)).toString("base64url");
  it.each([
    "?q=" + "x".repeat(101),
    "?q=a%00b",
    "?category=weddings",
    "?format=a4",
    "?sort=random",
    "?cursor=abc",
    "?limit=51",
    `?sort=popular&cursor=${cursorOf([2_147_483_648, randomUUID()])}`,
    `?sort=new&cursor=${cursorOf(["0000-01-01T00:00:00.000Z", randomUUID()])}`,
    `?sort=new&cursor=${cursorOf(["+275760-09-13T00:00:00.000Z", randomUUID()])}`,
  ])("rejects %s with 400", async (query) => {
    expect((await list(query)).status).toBe(400);
  });

  it("rejects a date cursor on the popular sort", async () => {
    await createTemplate(t.db);
    await createTemplate(t.db);
    const byDate = await list("?sort=new&limit=1");
    expect((await list(`?sort=popular&cursor=${byDate.body.nextCursor}`)).status).toBe(400);
  });

  it("shows the author's handle and name, never their id, and null for system templates", async () => {
    const alice = await createUser(t.db, { handle: handle(), name: "Alice" });
    await createTemplate(t.db, { authorId: alice.id, createdAt: new Date("2026-09-02T00:00:00Z") });
    await createTemplate(t.db, { createdAt: new Date("2026-09-01T00:00:00Z") });
    const [mine, seed] = (await list("?sort=new")).body.items;
    expect(mine.author).toEqual({ handle: alice.handle, name: "Alice" });
    expect(seed.author).toBeNull();
    expect(Object.keys(mine)).not.toContain("authorId");
    expect(JSON.stringify(mine)).not.toContain(alice.id);
  });
});

describe("GET /api/templates/:id", () => {
  it("returns a published template with its current document to anyone", async () => {
    const tpl = await createTemplate(t.db, { title: "Party" });
    const res = await call(h.get, { params: { id: tpl.id } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: tpl.id, title: "Party", currentVersion: 1, status: "published" });
    expect(res.body.doc).toMatchObject({ id: tpl.id, kind: "template" });
  });

  it("shows a hidden template only to its author and admins", async () => {
    const alice = await createUser(t.db, { handle: handle() });
    const bob = await createUser(t.db);
    const admin = await createUser(t.db, { role: "admin" });
    const tpl = await createTemplate(t.db, { authorId: alice.id, status: "hidden" });
    expect((await call(h.get, { params: { id: tpl.id } })).status).toBe(404);
    expect((await call(h.get, { as: bob, params: { id: tpl.id } })).status).toBe(404);
    expect((await call(h.get, { as: alice, params: { id: tpl.id } })).body.status).toBe("hidden");
    expect((await call(h.get, { as: admin, params: { id: tpl.id } })).status).toBe(200);
  });

  it("answers 404 for unknown and malformed ids", async () => {
    expect((await call(h.get, { params: { id: randomUUID() } })).status).toBe(404);
    expect((await call(h.get, { params: { id: "post-editorial-bloom" } })).status).toBe(404);
  });
});

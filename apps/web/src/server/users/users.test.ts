import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../../tests/support/db";
import { testDeps } from "../../../tests/support/deps";
import { createTemplate, createUser } from "../../../tests/support/factories";
import { call } from "../../../tests/support/invoke";
import { userHandlers } from "./handlers";

let t: TestDb;
let h: ReturnType<typeof userHandlers>;
beforeAll(async () => {
  t = await createTestDb();
  h = userHandlers(testDeps(t.db));
});
afterAll(() => t.close());

const profile = (handle: string, query = "") => call(h.get, { path: `/api/users/${handle}${query}`, params: { handle } });

describe("GET /api/users/:handle", () => {
  it("shows a creator's public profile and published templates, and nothing private", async () => {
    const alice = await createUser(t.db, { handle: `a_${randomUUID().slice(0, 8)}`, name: "Alice" });
    const older = await createTemplate(t.db, { authorId: alice.id, usesCount: 3, createdAt: new Date("2026-09-01T00:00:00Z") });
    const newer = await createTemplate(t.db, { authorId: alice.id, usesCount: 4, createdAt: new Date("2026-09-02T00:00:00Z") });
    await createTemplate(t.db, { authorId: alice.id, usesCount: 10, status: "hidden" });
    await createTemplate(t.db, { usesCount: 50 });
    const res = await profile(alice.handle!);
    expect(res.status).toBe(200);
    expect(res.body.profile).toEqual({ handle: alice.handle, name: "Alice", image: null, joinedAt: alice.createdAt.toISOString(), templates: 2, uses: 7 });
    expect(res.body.templates.items.map((i: { id: string }) => i.id)).toEqual([newer.id, older.id]);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(alice.email);
    expect(text).not.toContain(alice.id);
  });

  it("matches handles case-insensitively and answers 404 for unknown or malformed ones", async () => {
    const bob = await createUser(t.db, { handle: `b_${randomUUID().slice(0, 8)}` });
    expect((await profile(bob.handle!.toUpperCase())).status).toBe(200);
    expect((await profile("nobody_here_at_all")).status).toBe(404);
    expect((await profile("a!")).status).toBe(404);
  });

  it("pages through a creator's templates", async () => {
    const carol = await createUser(t.db, { handle: `c_${randomUUID().slice(0, 8)}` });
    for (let d = 1; d <= 3; d++) await createTemplate(t.db, { authorId: carol.id, createdAt: new Date(`2026-09-0${d}T00:00:00Z`) });
    const first = await profile(carol.handle!, "?limit=2");
    expect(first.body.templates.items).toHaveLength(2);
    const second = await profile(carol.handle!, `?limit=2&cursor=${first.body.templates.nextCursor}`);
    expect(second.body.templates).toMatchObject({ nextCursor: null });
    expect(second.body.templates.items).toHaveLength(1);
  });
});

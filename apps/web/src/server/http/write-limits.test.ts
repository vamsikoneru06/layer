import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../../tests/support/db";
import { emptyDoc } from "../../../tests/support/docs";
import { testDeps } from "../../../tests/support/deps";
import { createUser } from "../../../tests/support/factories";
import { call } from "../../../tests/support/invoke";
import { designHandlers } from "../designs/handlers";
import { folderHandlers } from "../folders/handlers";
import { meHandlers } from "../me/handlers";
import { RATE_LIMITS } from "../rate-limit/rules";

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(() => t.close());

describe("per-user write limit", () => {
  it("shares one budget across design, folder and profile writes", async () => {
    const fixed = new Date("2026-09-26T10:00:05.000Z");
    const deps = testDeps(t.db, { now: () => fixed });
    const designs = designHandlers(deps);
    const folders = folderHandlers(deps);
    const me = meHandlers(deps);
    const alice = await createUser(t.db);
    const bob = await createUser(t.db);
    const design = (await call(designs.create, { method: "POST", as: alice, body: { doc: emptyDoc() } })).body as { id: string };
    const folder = (await call(folders.create, { method: "POST", as: alice, body: { name: "Keep" } })).body as { id: string };

    const max = RATE_LIMITS.userWrite.max;
    // folders.create above already used one write.
    for (let i = 1; i < max; i++) {
      const res =
        i % 3 === 0
          ? await call(designs.patch, { method: "PATCH", as: alice, params: { id: design.id }, body: { title: `T${i}` } })
          : i % 3 === 1
            ? await call(folders.rename, { method: "PATCH", as: alice, params: { id: folder.id }, body: { name: `F${i}` } })
            : await call(me.patch, { method: "PATCH", as: alice, body: { name: `N${i}` } });
      expect(res.status, `write ${i}`).toBe(200);
    }

    for (const blocked of [
      call(designs.remove, { method: "DELETE", as: alice, params: { id: design.id } }),
      call(folders.create, { method: "POST", as: alice, body: { name: "More" } }),
      call(me.patch, { method: "PATCH", as: alice, body: { name: "Again" } }),
    ]) {
      const res = await blocked;
      expect(res.status).toBe(429);
      expect(res.headers.get("retry-after")).toMatch(/^\d+$/);
    }

    // Reads and other users are unaffected.
    expect((await call(designs.get, { as: alice, params: { id: design.id } })).status).toBe(200);
    expect((await call(folders.create, { method: "POST", as: bob, body: { name: "Bob" } })).status).toBe(201);
  });
});

describe("per-user read limit", () => {
  it("shares one budget across signed-in reads, separate from writes and other users", async () => {
    const fixed = new Date("2026-09-26T11:00:05.000Z");
    const deps = testDeps(t.db, { now: () => fixed });
    const designs = designHandlers(deps);
    const folders = folderHandlers(deps);
    const me = meHandlers(deps);
    const alice = await createUser(t.db);
    const bob = await createUser(t.db);
    const design = (await call(designs.create, { method: "POST", as: alice, body: { doc: emptyDoc() } })).body as { id: string };

    const max = RATE_LIMITS.userRead.max;
    for (let i = 0; i < max; i++) {
      const res =
        i % 3 === 0
          ? await call(designs.get, { as: alice, params: { id: design.id } })
          : i % 3 === 1
            ? await call(folders.list, { as: alice })
            : await call(me.get, { as: alice });
      expect(res.status, `read ${i}`).toBe(200);
    }

    const blocked = await call(designs.list, { as: alice });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toMatch(/^\d+$/);

    expect((await call(designs.patch, { method: "PATCH", as: alice, params: { id: design.id }, body: { title: "Still writable" } })).status).toBe(200);
    expect((await call(designs.list, { as: bob })).status).toBe(200);
  });
});

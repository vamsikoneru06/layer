import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../../tests/support/db";
import { testDeps } from "../../../tests/support/deps";
import { createTemplate, createUser } from "../../../tests/support/factories";
import { call } from "../../../tests/support/invoke";
import { templateHandlers } from "./handlers";

let t: TestDb;
let h: ReturnType<typeof templateHandlers>;
beforeAll(async () => {
  t = await createTestDb();
  h = templateHandlers(testDeps(t.db));
});
afterAll(() => t.close());

const report = (as: { id: string } | null, id: string, body: Record<string, unknown> = { reason: "spam" }, handlers = h) =>
  call(handlers.report, { method: "POST", as, params: { id }, body });

describe("POST /api/templates/:id/reports", () => {
  it("files one open report per user per template", async () => {
    const alice = await createUser(t.db);
    const bob = await createUser(t.db);
    const carol = await createUser(t.db);
    const tpl = await createTemplate(t.db, { authorId: alice.id });
    const first = await report(bob, tpl.id, { reason: "copyright", note: "  my photo  " });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ reason: "copyright", status: "open" });
    expect((await report(bob, tpl.id)).status).toBe(409);
    expect((await report(carol, tpl.id)).status).toBe(201);
  });

  it("refuses the author's own, hidden, unknown and malformed templates", async () => {
    const alice = await createUser(t.db);
    const bob = await createUser(t.db);
    const own = await createTemplate(t.db, { authorId: alice.id });
    const hidden = await createTemplate(t.db, { authorId: alice.id, status: "hidden" });
    expect((await report(alice, own.id)).status).toBe(422);
    expect((await report(bob, hidden.id)).status).toBe(404);
    expect((await report(bob, randomUUID())).status).toBe(404);
    expect((await report(bob, "x")).status).toBe(404);
    expect((await report(null, own.id)).status).toBe(401);
  });

  it.each([{ reason: "meh" }, { reason: "spam", note: "x".repeat(1001) }, { reason: "spam", extra: 1 }])("rejects %j with 400", async (body) => {
    const bob = await createUser(t.db);
    const tpl = await createTemplate(t.db);
    expect((await report(bob, tpl.id, body)).status).toBe(400);
  });

  it("allows 20 reports a day", async () => {
    const bob = await createUser(t.db);
    const fixed = templateHandlers(testDeps(t.db, { now: () => new Date("2026-09-26T10:00:00Z") }));
    for (let i = 0; i < 20; i++) expect((await report(bob, (await createTemplate(t.db)).id, { reason: "spam" }, fixed)).status).toBe(201);
    expect((await report(bob, (await createTemplate(t.db)).id, { reason: "spam" }, fixed)).status).toBe(429);
  });
});

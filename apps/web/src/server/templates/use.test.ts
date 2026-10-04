import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../../tests/support/db";
import { testDeps } from "../../../tests/support/deps";
import { templateDoc } from "../../../tests/support/docs";
import { createTemplate, createUser } from "../../../tests/support/factories";
import { call } from "../../../tests/support/invoke";
import { designs, templates, templateVersions } from "../db/schema";
import { templateHandlers } from "./handlers";

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(() => t.close());

const on = (iso: string) => templateHandlers(testDeps(t.db, { now: () => new Date(iso) }));
const use = (h: ReturnType<typeof templateHandlers>, as: { id: string } | null, id: string) => call(h.use, { method: "POST", as, params: { id } });
const uses = async (id: string) => (await t.db.select({ n: templates.usesCount }).from(templates).where(eq(templates.id, id)))[0]!.n;

describe("POST /api/templates/:id/use", () => {
  it("copies the current version into a new design owned by the caller", async () => {
    const alice = await createUser(t.db);
    const tpl = await createTemplate(t.db, { title: "Party", doc: templateDoc({ title: "Party" }) });
    const res = await use(on("2026-09-26T10:00:00Z"), alice, tpl.id);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ title: "Party", sourceTemplateId: tpl.id, sourceTemplateVersion: 1, version: 1 });
    expect(res.body.doc).toMatchObject({ id: res.body.id, kind: "design" });
    const [row] = await t.db.select().from(designs).where(eq(designs.id, res.body.id));
    expect(row?.ownerId).toBe(alice.id);
    const [version] = await t.db.select().from(templateVersions).where(eq(templateVersions.templateId, tpl.id));
    expect(version!.doc).toMatchObject({ id: tpl.id, kind: "template" });
  });

  it("counts each user once per template per UTC day", async () => {
    const alice = await createUser(t.db);
    const bob = await createUser(t.db);
    const tpl = await createTemplate(t.db);
    const day1 = on("2026-09-26T23:59:00Z");
    expect((await use(day1, alice, tpl.id)).status).toBe(201);
    expect((await use(day1, alice, tpl.id)).status).toBe(201);
    expect(await uses(tpl.id)).toBe(1);
    await use(day1, bob, tpl.id);
    expect(await uses(tpl.id)).toBe(2);
    await use(on("2026-09-27T00:01:00Z"), alice, tpl.id);
    expect(await uses(tpl.id)).toBe(3);
  });

  it("answers 401 to guests and 404 for hidden, unknown or malformed templates, but lets authors use their own hidden ones", async () => {
    const alice = await createUser(t.db);
    const bob = await createUser(t.db);
    const h = on("2026-09-26T10:00:00Z");
    const hidden = await createTemplate(t.db, { authorId: alice.id, status: "hidden" });
    expect((await use(h, null, hidden.id)).status).toBe(401);
    expect((await use(h, bob, hidden.id)).status).toBe(404);
    expect((await use(h, bob, randomUUID())).status).toBe(404);
    expect((await use(h, bob, "nope")).status).toBe(404);
    expect((await use(h, alice, hidden.id)).status).toBe(201);
  });
});

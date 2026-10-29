import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../../tests/support/db";
import { testDeps, tickingClock } from "../../../tests/support/deps";
import { createTemplate, createUser } from "../../../tests/support/factories";
import { call } from "../../../tests/support/invoke";
import { auditLog, reports } from "../db/schema";
import { templateHandlers } from "../templates/handlers";
import { adminHandlers } from "./handlers";

let t: TestDb;
let h: ReturnType<typeof adminHandlers>;
let gallery: ReturnType<typeof templateHandlers>;
beforeAll(async () => {
  t = await createTestDb();
  h = adminHandlers(testDeps(t.db, { now: tickingClock() }));
  gallery = templateHandlers(testDeps(t.db));
});
afterAll(() => t.close());

const handle = () => `u_${randomUUID().slice(0, 8)}`;
const galleryIds = async (query = "?sort=new") => (await call(gallery.list, { path: `/api/templates${query}&limit=50` })).body.items.map((i: { id: string }) => i.id);
const fileReport = (templateId: string, reporterId: string, createdAt: Date) =>
  t.db.insert(reports).values({ templateId, reporterId, reason: "spam", createdAt }).returning().then((r) => r[0]!);

describe("admin moderation", () => {
  it("is closed to guests (401) and non-admins (403)", async () => {
    const bob = await createUser(t.db);
    const id = randomUUID();
    const cases = [
      (as: { id: string } | null) => call(h.reports, { as }),
      (as: { id: string } | null) => call(h.templates, { as }),
      (as: { id: string } | null) => call(h.resolveReport, { method: "POST", as, params: { id }, body: { status: "dismissed" } }),
      (as: { id: string } | null) => call(h.moderate, { method: "POST", as, params: { id }, body: { action: "hide" } }),
    ];
    for (const run of cases) {
      expect((await run(null)).status).toBe(401);
      expect((await run(bob)).status).toBe(403);
    }
  });

  it("needs two-step verification set up and a code from the last 12 hours", async () => {
    const reports = (as: { id: string }, at?: string) => call(h.reports, { as, headers: at ? { "x-test-two-factor-at": at } : {} });
    // The ticking clock starts at 2026-09-25T09:00:00Z.
    const unenrolled = await createUser(t.db, { role: "admin" });
    const admin = await createUser(t.db, { role: "admin", twoFactorEnabled: true });

    const setup = await reports(unenrolled);
    expect(setup.status).toBe(403);
    expect(setup.body.code).toBe("two_factor_setup_required");
    const never = await reports(admin, "never");
    expect(never.status).toBe(403);
    expect(never.body.code).toBe("two_factor_required");
    expect((await reports(admin, "2026-09-24T20:00:00.000Z")).body.code).toBe("two_factor_required");
    expect((await reports(admin, "2026-09-24T22:00:00.000Z")).status).toBe(200);
  });

  it("lists open reports oldest first, with the template, its author and the reporter", async () => {
    const admin = await createUser(t.db, { role: "admin", twoFactorEnabled: true });
    const author = await createUser(t.db, { handle: handle() });
    const reporter = await createUser(t.db, { handle: handle() });
    const tpl = await createTemplate(t.db, { authorId: author.id, title: "Loud" });
    const older = await fileReport(tpl.id, reporter.id, new Date("2020-01-01T00:00:00Z"));
    const newer = await fileReport(tpl.id, (await createUser(t.db)).id, new Date("2020-01-02T00:00:00Z"));
    const first = await call(h.reports, { as: admin, path: "/api/admin/reports?limit=1" });
    expect(first.body.items).toEqual([
      expect.objectContaining({ id: older.id, reason: "spam", status: "open", reporterHandle: reporter.handle, template: { id: tpl.id, title: "Loud", status: "published", featured: false, authorHandle: author.handle } }),
    ]);
    const second = await call(h.reports, { as: admin, path: `/api/admin/reports?limit=1&cursor=${first.body.nextCursor}` });
    expect(second.body.items[0].id).toBe(newer.id);
  });

  it("resolves a report once, recording who did it", async () => {
    const admin = await createUser(t.db, { role: "admin", twoFactorEnabled: true });
    const tpl = await createTemplate(t.db);
    const r = await fileReport(tpl.id, (await createUser(t.db)).id, new Date());
    const resolve = () => call(h.resolveReport, { method: "POST", as: admin, params: { id: r.id }, body: { status: "dismissed" } });
    const res = await resolve();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: r.id, status: "dismissed" });
    const [row] = await t.db.select().from(reports).where(eq(reports.id, r.id));
    expect(row).toMatchObject({ status: "dismissed", resolvedBy: admin.id });
    const audit = await t.db.select().from(auditLog).where(and(eq(auditLog.targetId, r.id), eq(auditLog.action, "report.resolve")));
    expect(audit).toMatchObject([{ actorId: admin.id, targetType: "report", meta: { status: "dismissed", templateId: tpl.id } }]);
    expect((await resolve()).status).toBe(409);
    expect((await call(h.resolveReport, { method: "POST", as: admin, params: { id: randomUUID() }, body: { status: "dismissed" } })).status).toBe(404);
  });

  it("hiding takes a template out of the gallery, unfeatures it and closes its open reports; restoring brings it back", async () => {
    const admin = await createUser(t.db, { role: "admin", twoFactorEnabled: true });
    const tpl = await createTemplate(t.db, { featured: true });
    await fileReport(tpl.id, (await createUser(t.db)).id, new Date());
    await fileReport(tpl.id, (await createUser(t.db)).id, new Date());
    const moderate = (action: string) => call(h.moderate, { method: "POST", as: admin, params: { id: tpl.id }, body: { action } });

    const hidden = await moderate("hide");
    expect(hidden.status).toBe(200);
    expect(hidden.body).toMatchObject({ id: tpl.id, status: "hidden", featured: false });
    expect(await galleryIds()).not.toContain(tpl.id);
    const open = await t.db.select().from(reports).where(and(eq(reports.templateId, tpl.id), eq(reports.status, "open")));
    expect(open).toEqual([]);
    const [audit] = await t.db.select().from(auditLog).where(and(eq(auditLog.targetId, tpl.id), eq(auditLog.action, "template.hide")));
    expect(audit).toMatchObject({ actorId: admin.id, meta: { reportsResolved: 2 } });
    const hiddenList = await call(h.templates, { as: admin, path: "/api/admin/templates?status=hidden" });
    expect(hiddenList.body.items.map((i: { id: string }) => i.id)).toContain(tpl.id);

    expect((await moderate("restore")).body.status).toBe("published");
    expect(await galleryIds()).toContain(tpl.id);
  });

  it("features only published templates", async () => {
    const admin = await createUser(t.db, { role: "admin", twoFactorEnabled: true });
    const tpl = await createTemplate(t.db);
    const hiddenTpl = await createTemplate(t.db, { status: "hidden" });
    const moderate = (id: string, action: string) => call(h.moderate, { method: "POST", as: admin, params: { id }, body: { action } });
    expect((await moderate(tpl.id, "feature")).body.featured).toBe(true);
    expect(await galleryIds("?sort=featured")).toContain(tpl.id);
    expect((await moderate(tpl.id, "unfeature")).body.featured).toBe(false);
    expect((await moderate(hiddenTpl.id, "feature")).status).toBe(409);
    expect((await moderate(randomUUID(), "hide")).status).toBe(404);
    expect((await moderate(tpl.id, "delete")).status).toBe(400);
  });
});

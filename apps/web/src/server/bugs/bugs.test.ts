import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../../tests/support/db";
import { testDeps, tickingClock } from "../../../tests/support/deps";
import { createUser } from "../../../tests/support/factories";
import { call } from "../../../tests/support/invoke";
import { auditLog, bugReports } from "../db/schema";
import { meHandlers } from "../me/handlers";
import { deleteAccount } from "../me/service";
import { RATE_LIMITS } from "../rate-limit/rules";
import { bugReportHandlers } from "./handlers";

let t: TestDb;
let h: ReturnType<typeof bugReportHandlers>;
beforeAll(async () => {
  t = await createTestDb();
  h = bugReportHandlers(testDeps(t.db, { now: tickingClock() }));
});
afterAll(() => t.close());

const send = (body: unknown, opts: { as?: { id: string } | null; ip?: string; headers?: Record<string, string> } = {}) =>
  call(h.create, { method: "POST", path: "/api/bug-reports", body, ...opts });
const stored = async (id: string) => (await t.db.select().from(bugReports).where(eq(bugReports.id, id)))[0]!;
let lastIp = 0;
/** A new guest address per call, so tests never share a rate-limit bucket. */
const freshIp = () => `198.51.100.${++lastIp}`;

describe("POST /api/bug-reports", () => {
  it("takes a guest's report with the browser and no account", async () => {
    const res = await send({ summary: "  Export is blank  ", expected: "A PNG", steps: "Open, export" }, { ip: freshIp(), headers: { "user-agent": "TestBrowser/1.0" } });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: "open" });
    expect(await stored(res.body.id)).toMatchObject({ reporterId: null, summary: "Export is blank", expected: "A PNG", steps: "Open, export", userAgent: "TestBrowser/1.0" });
  });

  it("links a signed-in report to the account", async () => {
    const alice = await createUser(t.db);
    const res = await send({ summary: "Text jumps" }, { as: alice });
    expect(res.status).toBe(201);
    expect(await stored(res.body.id)).toMatchObject({ reporterId: alice.id, expected: "", steps: "" });
  });

  it("keeps only a same-site path for the page, without its query, fragment or share token", async () => {
    const alice = await createUser(t.db);
    const page = async (value: string) => (await stored((await send({ summary: "x", page: value }, { as: alice })).body.id)).page;
    expect(await page("/edit/abc?token=secret#frame")).toBe("/edit/abc");
    expect(await page("/s/sharetoken123")).toBe("/s/:token");
    expect(await page("https://evil.example/x")).toBe("");
    expect(await page("//evil.example/x")).toBe("");
  });

  it("rejects an empty or oversized report and unknown fields", async () => {
    const alice = await createUser(t.db);
    expect((await send({ summary: "   " }, { as: alice })).status).toBe(400);
    expect((await send({ summary: "x".repeat(2001) }, { as: alice })).status).toBe(400);
    expect((await send({ summary: "x", email: "a@b.c" }, { as: alice })).status).toBe(400);
  });

  it("refuses cross-origin posts", async () => {
    expect((await call(h.create, { method: "POST", body: { summary: "x" }, origin: "https://evil.example" })).status).toBe(403);
  });

  it("rate-limits per account, and per IP for guests", async () => {
    const alice = await createUser(t.db);
    for (let i = 0; i < RATE_LIMITS.bugReport.max; i++) expect((await send({ summary: `a${i}` }, { as: alice })).status).toBe(201);
    expect((await send({ summary: "one more" }, { as: alice })).status).toBe(429);
    expect((await send({ summary: "bob is fine" }, { as: await createUser(t.db) })).status).toBe(201);

    const ip = freshIp();
    for (let i = 0; i < RATE_LIMITS.bugReport.max; i++) expect((await send({ summary: `g${i}` }, { ip })).status).toBe(201);
    expect((await send({ summary: "one more" }, { ip })).status).toBe(429);
  });
});

describe("admin bug reports", () => {
  it("are closed to guests (401) and non-admins (403)", async () => {
    const bob = await createUser(t.db);
    const id = randomUUID();
    for (const as of [null, bob]) {
      const expected = as ? 403 : 401;
      expect((await call(h.list, { as })).status).toBe(expected);
      expect((await call(h.resolve, { method: "POST", as, params: { id }, body: { status: "fixed" } })).status).toBe(expected);
    }
  });

  it("lists open reports oldest first, with the reporter's email when there is one", async () => {
    const admin = await createUser(t.db, { role: "admin" });
    const reporter = await createUser(t.db);
    await t.db.delete(bugReports);
    const [older] = await t.db.insert(bugReports).values({ summary: "older", reporterId: reporter.id, createdAt: new Date("2020-01-01T00:00:00Z") }).returning();
    const [newer] = await t.db.insert(bugReports).values({ summary: "newer", createdAt: new Date("2020-01-02T00:00:00Z") }).returning();
    const first = await call(h.list, { as: admin, path: "/api/admin/bug-reports?limit=1" });
    expect(first.body.items).toEqual([expect.objectContaining({ id: older!.id, summary: "older", status: "open", reporterEmail: reporter.email })]);
    const second = await call(h.list, { as: admin, path: `/api/admin/bug-reports?limit=1&cursor=${first.body.nextCursor}` });
    expect(second.body.items).toEqual([expect.objectContaining({ id: newer!.id, reporterEmail: null })]);
  });

  it("resolves a report once, recording who did it", async () => {
    const admin = await createUser(t.db, { role: "admin" });
    const [r] = await t.db.insert(bugReports).values({ summary: "crash" }).returning();
    const resolve = () => call(h.resolve, { method: "POST", as: admin, params: { id: r!.id }, body: { status: "fixed" } });
    const res = await resolve();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: r!.id, status: "fixed" });
    expect(await stored(r!.id)).toMatchObject({ status: "fixed", resolvedBy: admin.id });
    const audit = await t.db.select().from(auditLog).where(and(eq(auditLog.targetId, r!.id), eq(auditLog.action, "bug_report.resolve")));
    expect(audit).toMatchObject([{ actorId: admin.id, targetType: "bug_report", meta: { status: "fixed" } }]);
    expect((await resolve()).status).toBe(409);
    expect((await call(h.resolve, { method: "POST", as: admin, params: { id: randomUUID() }, body: { status: "fixed" } })).status).toBe(404);
    expect((await call(h.resolve, { method: "POST", as: admin, params: { id: r!.id }, body: { status: "open" } })).status).toBe(400);
  });
});

describe("bug reports and the reporter's account", () => {
  it("are in the reporter's export only, and deleted with the account", async () => {
    const me = meHandlers(testDeps(t.db));
    const alice = await createUser(t.db);
    const bob = await createUser(t.db);
    const mine = (await send({ summary: "Alice's bug" }, { as: alice })).body.id;
    await send({ summary: "Bob's bug" }, { as: bob });

    const exported = await call(me.export, { as: alice });
    expect(exported.body.bugReports).toEqual([expect.objectContaining({ id: mine, summary: "Alice's bug" })]);
    expect(JSON.stringify(exported.body)).not.toContain("Bob's bug");

    await deleteAccount(t.db, alice.id, new Date());
    expect(await t.db.select().from(bugReports).where(eq(bugReports.id, mine))).toEqual([]);
    expect(await t.db.select().from(bugReports).where(eq(bugReports.reporterId, bob.id))).toHaveLength(1);
  });
});

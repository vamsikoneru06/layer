import { eq, sql } from "drizzle-orm";
import { createEmptyDoc } from "@vash/schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, dbErrorMessage, type TestDb } from "../../../tests/support/db";
import { createFolder, createUser } from "../../../tests/support/factories";
import { auditLog, designs, folders, reports, templates, user } from "./schema";

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(() => t.close());

describe("database schema", () => {
  it("creates every table", async () => {
    const result = (await t.db.execute(
      sql`select table_name from information_schema.tables where table_schema = 'public' order by table_name`,
    )) as unknown as { rows: { table_name: string }[] };
    expect(result.rows.map((r) => r.table_name)).toEqual(
      expect.arrayContaining([
        "account", "assets", "audit_log", "designs", "folders", "rate_limits", "reports", "session",
        "share_links", "storage_deletions", "template_uses", "template_versions", "templates", "user", "verification",
      ]),
    );
  });

  it("cascades a user's rows when the user is deleted", async () => {
    const owner = await createUser(t.db);
    const folder = await createFolder(t.db, owner.id);
    await t.db.insert(designs).values({
      ownerId: owner.id,
      folderId: folder.id,
      title: "Card",
      doc: createEmptyDoc({ id: "d1", kind: "design", title: "Card", format: "ig-post" }),
    });
    await t.db.delete(user).where(eq(user.id, owner.id));
    expect(await t.db.select().from(folders).where(eq(folders.ownerId, owner.id))).toEqual([]);
    expect(await t.db.select().from(designs).where(eq(designs.ownerId, owner.id))).toEqual([]);
  });

  it("keeps the audit log append-only", async () => {
    await t.db.insert(auditLog).values({ actorId: "u1", action: "test", targetType: "user", targetId: "u1" });
    expect(await dbErrorMessage(t.db.update(auditLog).set({ action: "tampered" }))).toMatch(/append-only/);
    expect(await dbErrorMessage(t.db.delete(auditLog))).toMatch(/append-only/);
    expect(await dbErrorMessage(t.db.execute(sql`truncate audit_log`))).toMatch(/append-only/);
  });

  it("rejects roles outside user/admin at the database level", async () => {
    const u = await createUser(t.db);
    expect(await dbErrorMessage(t.db.execute(sql`update "user" set role = 'root' where id = ${u.id}`))).toMatch(/user_role_check/);
  });

  it("allows one report per reporter per template", async () => {
    const reporter = await createUser(t.db);
    const [tpl] = await t.db
      .insert(templates)
      .values({ title: "T", category: "celebrations", format: "ig-post", width: 1080, height: 1080 })
      .returning();
    await t.db.insert(reports).values({ templateId: tpl!.id, reporterId: reporter.id, reason: "spam" });
    expect(
      await dbErrorMessage(t.db.insert(reports).values({ templateId: tpl!.id, reporterId: reporter.id, reason: "other" })),
    ).toMatch(/reports_template_reporter_unique/);
  });
});

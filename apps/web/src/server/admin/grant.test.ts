import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../../tests/support/db";
import { createUser } from "../../../tests/support/factories";
import { auditLog, user } from "../db/schema";
import { grantAdmin } from "./grant";

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(() => t.close());

const NOW = new Date("2026-10-04T10:00:00.000Z");

describe("grantAdmin", () => {
  it("makes the account with that email (any case) an admin, once, with an audit entry", async () => {
    const owner = await createUser(t.db, { email: "owner@example.test" });
    const other = await createUser(t.db);
    expect(await grantAdmin(t.db, "  Owner@Example.TEST ", NOW)).toBe("granted");
    expect(await grantAdmin(t.db, "owner@example.test", NOW)).toBe("already");
    const roles = await t.db.select({ id: user.id, role: user.role }).from(user);
    expect(roles).toEqual(expect.arrayContaining([{ id: owner.id, role: "admin" }, { id: other.id, role: "user" }]));
    expect(await t.db.select().from(auditLog).where(eq(auditLog.targetId, owner.id))).toMatchObject([
      { actorId: "operator", action: "user.grant_admin", targetType: "user" },
    ]);
  });

  it("reports an unknown email without creating anything", async () => {
    expect(await grantAdmin(t.db, "nobody@example.test", NOW)).toBe("missing");
  });
});

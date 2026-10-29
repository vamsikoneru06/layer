import { readFileSync } from "node:fs";
import { V1_CATEGORIES } from "@vash/schema";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../../tests/support/db";
import { createTemplate, createUser } from "../../../tests/support/factories";
import { templates, user } from "./schema";

const migration = readFileSync(new URL("../../../drizzle/0006_job_categories.sql", import.meta.url), "utf8");

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(() => t.close());

describe("migration 0006: job categories", () => {
  it("uses exactly the documents' v1 to v2 mapping", () => {
    const pairs = [...migration.split("--> statement-breakpoint")[0]!.matchAll(/WHEN '([a-z-]+)' THEN '([a-z-]+)'/g)];
    expect(Object.fromEntries(pairs.map(([, from, to]) => [from, to]))).toEqual(V1_CATEGORIES);
  });

  it("moves stored templates and onboarding interests from topics to jobs", async () => {
    const food = await createTemplate(t.db, { category: "food" });
    const already = await createTemplate(t.db, { category: "invitations" });
    const u = await createUser(t.db);
    await t.db.update(user).set({ interests: ["travel", "minimal", "birthday"] }).where(eq(user.id, u.id));

    for (const statement of migration.split("--> statement-breakpoint")) await t.db.execute(sql.raw(statement));

    const category = async (id: string) => (await t.db.select({ c: templates.category }).from(templates).where(eq(templates.id, id)))[0]!.c;
    expect(await category(food.id)).toBe("menus");
    expect(await category(already.id)).toBe("invitations");
    const [row] = await t.db.select({ interests: user.interests }).from(user).where(eq(user.id, u.id));
    // travel and minimal both become photo-posts, kept once.
    expect([...row!.interests].sort()).toEqual(["celebrations", "photo-posts"]);
  });
});

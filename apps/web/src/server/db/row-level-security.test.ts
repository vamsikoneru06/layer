import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, dbErrorMessage, type TestDb } from "../../../tests/support/db";
import { emptyDoc } from "../../../tests/support/docs";
import { createAsset, createDesign, createFolder, createTemplate, createUser } from "../../../tests/support/factories";
import { assets, designs, folders, shareLinks } from "./schema";
import { outsideUserScope, runAsUser, scopeStatements } from "./user-scope";

let t: TestDb;
let alice: string;
let bob: string;
let bobDesign: string;
let bobTemplate: string;

beforeAll(async () => {
  t = await createTestDb();
  alice = (await createUser(t.db)).id;
  bob = (await createUser(t.db)).id;
  await createDesign(t.db, alice, emptyDoc());
  bobDesign = (await createDesign(t.db, bob, emptyDoc())).id;
  await createFolder(t.db, alice, "Alice's");
  await createFolder(t.db, bob, "Bob's");
  await t.db.insert(shareLinks).values({ designId: bobDesign, createdBy: bob, tokenHash: "h".repeat(64) });
  await createAsset(t.db, { ownerId: alice });
  await createAsset(t.db, { ownerId: bob });
  await createAsset(t.db, { ownerId: null }); // a bundled sample photo
  bobTemplate = (await createTemplate(t.db, { authorId: bob })).id;
});
afterAll(() => t.close());

// These queries deliberately leave out the owner filter the repositories always add.
describe("row-level security for a signed-in user", () => {
  it("hides other users' designs, folders, share links and private photos", async () => {
    await runAsUser(alice, async () => {
      expect((await t.db.select().from(designs)).map((d) => d.ownerId)).toEqual([alice]);
      expect((await t.db.select().from(folders)).map((f) => f.ownerId)).toEqual([alice]);
      expect(await t.db.select().from(shareLinks)).toEqual([]);
      expect((await t.db.select().from(assets)).map((a) => a.ownerId).sort()).toEqual([alice, null].sort());
    });
  });

  it("applies inside transactions too", async () => {
    const seen = await runAsUser(alice, () => t.db.transaction((tx) => tx.select({ ownerId: designs.ownerId }).from(designs)));
    expect(seen).toEqual([{ ownerId: alice }]);
  });

  it("can't change or delete another user's rows", async () => {
    await runAsUser(alice, async () => {
      expect(await t.db.update(designs).set({ title: "Mine now" }).where(eq(designs.id, bobDesign)).returning()).toEqual([]);
      expect(await t.db.delete(designs).where(eq(designs.id, bobDesign)).returning()).toEqual([]);
      expect(await t.db.update(assets).set({ ownerId: alice }).where(eq(assets.ownerId, bob)).returning()).toEqual([]);
    });
    const [still] = await t.db.select().from(designs).where(eq(designs.id, bobDesign));
    expect(still?.title).not.toBe("Mine now");
  });

  it("can't write rows owned by someone else", async () => {
    await runAsUser(alice, async () => {
      expect(await dbErrorMessage(t.db.insert(folders).values({ ownerId: bob, name: "Planted" }))).toMatch(/row-level security/);
      expect(await dbErrorMessage(t.db.update(designs).set({ ownerId: bob }).where(eq(designs.ownerId, alice)))).toMatch(/row-level security/);
      expect(
        await dbErrorMessage(t.db.insert(shareLinks).values({ designId: bobDesign, createdBy: alice, tokenHash: "x".repeat(64) })),
      ).toMatch(/row-level security/);
      // System-owned copies only for a template you author.
      const copy = { kind: "photo" as const, visibility: "public" as const, status: "ready" as const, mime: "image/jpeg" as const, bytes: 1, width: 1, height: 1 };
      const id = randomUUID();
      expect(
        await dbErrorMessage(t.db.insert(assets).values({ ...copy, id, ownerId: null, templateId: bobTemplate, storageKey: `t/${bobTemplate}/${id}` })),
      ).toMatch(/row-level security/);
    });
  });

  it("returns nothing when the role is set without a user id", async () => {
    const rows = await t.db.transaction(async (tx) => {
      await tx.execute(sql`set local role vash_app`);
      return tx.select().from(designs);
    });
    expect(rows).toEqual([]);
  });

  it("leaves system work and vetted cross-user reads unrestricted", async () => {
    expect(await t.db.select().from(designs)).toHaveLength(2);
    const fromInside = await runAsUser(alice, () => outsideUserScope(() => t.db.select().from(designs)));
    expect(fromInside).toHaveLength(2);
  });
});

describe("scopeStatements", () => {
  it("refuses an id that isn't a plain token", () => {
    expect(() => scopeStatements("x'; drop table designs; --")).toThrow();
    expect(scopeStatements("u_AbC-123")).toContain("'u_AbC-123'");
  });
});

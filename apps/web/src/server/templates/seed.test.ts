import { readdirSync, readFileSync } from "node:fs";
import { parseDoc, type Doc } from "@vash/schema";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../../tests/support/db";
import { templates, templateVersions } from "../db/schema";
import { loadSeedTemplates, seedTemplateId } from "./seed";

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(() => t.close());

const dir = new URL("../../../templates/seed/", import.meta.url);
function seedDocs(): Doc[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => {
      const parsed = parseDoc(JSON.parse(readFileSync(new URL(f, dir), "utf8")), { kind: "template" });
      if (!parsed.ok) throw new Error(f);
      return parsed.doc;
    });
}
const NOW = new Date("2026-09-26T12:00:00.000Z");

describe("loadSeedTemplates", () => {
  it("creates every seed as a published system template, and a rerun changes nothing", async () => {
    const docs = seedDocs();
    expect(await loadSeedTemplates(t.db, docs, NOW)).toEqual({ created: docs.length, updated: 0, unchanged: 0 });
    const rows = await t.db.select().from(templates);
    expect(rows).toHaveLength(docs.length);
    for (const row of rows) expect(row).toMatchObject({ authorId: null, status: "published", currentVersion: 1, featured: false, usesCount: 0 });
    const first = docs[0]!;
    const [row] = await t.db.select().from(templates).where(eq(templates.id, seedTemplateId(first.id)));
    expect(row).toMatchObject({ title: first.meta.title, category: first.meta.category, format: first.meta.format, width: first.artboard.width });
    expect(row!.searchText).toBe([first.meta.title, ...first.meta.tags].join(" "));
    const [version] = await t.db.select().from(templateVersions).where(eq(templateVersions.templateId, row!.id));
    expect(version!.doc.id).toBe(row!.id);

    expect(await loadSeedTemplates(t.db, seedDocs(), NOW)).toEqual({ created: 0, updated: 0, unchanged: seedDocs().length });
    expect(await t.db.select().from(templateVersions)).toHaveLength(seedDocs().length);
  });

  it("adds a version when a seed changes, keeping the old version and the counters", async () => {
    const docs = seedDocs();
    const id = seedTemplateId(docs[0]!.id);
    await t.db.update(templates).set({ usesCount: 7, featured: true }).where(eq(templates.id, id));
    docs[0] = { ...docs[0]!, meta: { ...docs[0]!.meta, title: "Renamed seed" } };
    expect(await loadSeedTemplates(t.db, docs, NOW)).toEqual({ created: 0, updated: 1, unchanged: docs.length - 1 });
    const [row] = await t.db.select().from(templates).where(eq(templates.id, id));
    expect(row).toMatchObject({ title: "Renamed seed", currentVersion: 2, usesCount: 7, featured: true });
    const versions = await t.db.select().from(templateVersions).where(eq(templateVersions.templateId, id)).orderBy(asc(templateVersions.version));
    expect(versions.map((v) => v.doc.meta.title)).toEqual([expect.not.stringMatching("Renamed seed"), "Renamed seed"]);
  });

  it("derives a stable UUID from each slug", () => {
    expect(seedTemplateId("post-editorial-bloom")).toBe(seedTemplateId("post-editorial-bloom"));
    expect(seedTemplateId("post-editorial-bloom")).not.toBe(seedTemplateId("post-loud-quote"));
    expect(seedTemplateId("x")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

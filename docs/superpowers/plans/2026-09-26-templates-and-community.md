# Templates & Community Implementation Plan (Phase 0, Plan 3 of 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- Anyone can browse and search a gallery of templates, open one, and (when signed in) turn it into their own design.
- Authors can publish template drafts with a privacy scrub.
- Owners can share designs by link, and others can remix them.
- Creators get public profiles.
- Users can report templates, and admins can moderate them with every action audited.

**Architecture:**
- New server modules follow the existing layering: `templates/`, `shares/`, `users/`, `admin/`. Each has a repository for Drizzle queries, a service for business rules, and handlers built with the `endpoint()` kernel.
- Photos that leave their owner are copied as whole objects, never re-referenced:
  - Publishing copies kept photos and the thumbnail into the public bucket as **system-owned** assets linked to the template.
  - Remixing copies the sharer's private photos into the remixer's account.
- A shared `copyAll` helper makes multi-object copies all-or-nothing: copies already made are queued in the storage-deletion outbox, and the caller gets 503.

**Tech Stack:** Next.js 16 route handlers · Drizzle 0.45 over Postgres/PGlite · Zod 4 DTOs · `@vash/schema` (validator, `lintTemplate`, `scrubForPublish`, `scanForPii`) · S3 `CopyObject` against Supabase Storage · Vitest 5.

**Spec:** `docs/superpowers/specs/2026-09-24-vash-design.md`: §3 (journeys 3–5), §8.2 (using a template), §8.3 (seed templates), §8.4 (publishing), §9.2 (tables), §9.3 (API rows Share, Templates, Users, Admin), §9.5 (IDOR, share-link guessing, data leakage), §9.6 (rate limits). Also read `docs/decisions.md` rows 18, 25, 27, 29, 30, and the gallery, shared-view, profile and moderation sections of `docs/frontend-design-brief.md` (§6.2–6.5 and the Moderation page).

**Plan series:**
- Plan 1 (backend foundation): done.
- Plan 2 (storage and uploads): done.
- **Plan 3 (this one):** templates, gallery, share/remix, profiles, moderation.
- Plan 4: deploy (Vercel, Neon, Supabase provisioning, `deploy.yml`).

## Global Constraints

- Run commands through corepack, because bare `pnpm` isn't on PATH: `corepack pnpm --filter @vash/web …`.
- Work in the worktree `C:\Users\koner\vash-plan3` on branch `feat/templates-community`. Never switch branches in the shared `VASH` folder.
- Rate limits (spec §9.6):
  - "Share link create | 30 / hour | user"
  - "Shared view | 120 / minute | IP"
  - "Publish | 5 / day | user"
  - "Report | 20 / day | user"
  - "Gallery / public reads | 300 / minute | IP"
  
  All of these already exist in `RATE_LIMITS`. Other signed-in writes use `RATE_LIMITS.userWrite`, and design-creating actions (use, remix) use `RATE_LIMITS.designCreate`.
- "Lists use keyset (cursor) pagination, max 50 per page."
- Share links: "128-bit random tokens, stored as SHA-256 hashes, revocable, read-only, rate-limited". "Only the SHA-256 of the token is stored".
- Access control: "Every query owner-scoped in repositories; foreign resources return **404** (no existence leaks); admin checks on `/api/admin/*`". Admin endpoints answer 403 to non-admins (decision row 18).
- Using a template: "*Use this template* **copies** the current template version into a new design (`sourceTemplateId`, `sourceTemplateVersion` recorded)". "Signed-in uses are counted once per user per template per UTC day."
- Publishing server checks: "schema validation; template lint; every referenced asset is the author's own ready asset (or seed/public); kept photos are copied from the private bucket to the public bucket; PII warnings returned; rate limit 5/day."
- Moderation: "templates go live immediately; reports feed the admin queue; admins hide/restore/feature; every admin action is written to `audit_log`. Republishing creates a new version; existing designs keep their copies."
- Never log share tokens, signed URLs or secrets. `endpoint()` already masks `/api/shared/:token` in request logs. Don't put tokens in any log field.
- No third-party artwork. The seed templates are the existing originals in `apps/web/templates/seed/`.

## Review Focus

1. **Search text containing tsquery syntax, quotes, emoji or 100 characters** (`a & b | !c:*`, `'); drop table templates; --`). The gallery answers 200 with results or an empty list, never 500. Anything over 100 characters is a 400. Test in Task 2.
2. **A draft that references another user's private photo, which the author then tries to keep.** The answer is 422, and nothing is copied to the public bucket. Tests in Tasks 4 and 5.
3. **The original owner deleting the source photo after publishing or after someone remixed.** The template and the remix keep showing their own copies. Tests in Tasks 5 and 7.
4. **A hidden template reached directly**: by id, via use, report or a profile. It's invisible (404, or missing from lists) to everyone except its author and admins. Tests in Tasks 2, 3, 8 and 9.
5. **Storage failing halfway through a publish or remix.** The answer is 503 with no half-written template or design, and every copied object is queued for deletion. Tests in Tasks 5 and 7.

---

## File Structure

```
apps/web/
├─ drizzle/0004_templates_community.sql          assets.template_id, popular index
├─ scripts/seed.ts                                `pnpm db:seed` (was referenced, never written)
├─ src/server/
│  ├─ db/schema.ts                                (modify) assets.templateId, indexes, check
│  ├─ assets/repository.ts                        (modify) quota counts published copies
│  ├─ assets/service.ts                           (modify) copy() now takes object refs
│  ├─ storage/types.ts, s3.ts                     (modify) cross-bucket copy
│  ├─ storage/copies.ts                           copyAll + queueObjects
│  ├─ designs/handlers.ts                         (modify) export toDesignJson
│  ├─ me/service.ts                               (modify) account deletion queues published copies
│  ├─ templates/
│  │  ├─ repository.ts                            cards, gallery query, inserts
│  │  ├─ view.ts                                  canSee, toTemplateJson
│  │  ├─ gallery.ts                               rank cursor, galleryPage
│  │  ├─ seed.ts                                  seedTemplateId, loadSeedTemplates
│  │  ├─ use.ts                                   useTemplate
│  │  ├─ draft.ts                                 analyzeDraft, PUBLISH_LIMITS
│  │  ├─ publish.ts                               publishTemplate
│  │  ├─ reports.ts                               reportTemplate
│  │  └─ handlers.ts                              /api/templates/*
│  ├─ shares/{repository,service,remix,handlers}.ts
│  ├─ users/{repository,handlers}.ts
│  ├─ admin/{repository,service,handlers}.ts
│  └─ context.ts                                  (modify) wire new handlers
├─ src/app/api/templates/…, designs/[id]/share/…, shared/[token]/…, users/[handle]/…, admin/…
└─ tests/support/{docs,factories,storage}.ts      (modify) templateDoc, createTemplate, createDesign, failCopy
packages/schema/src/template.ts                    (modify) replaceAssetIds
docs/decisions.md                                  (modify) rows 31–38
```

---

### Task 1: Schema additions, template repository, seed loader

**Files:**
- Modify: `apps/web/src/server/db/schema.ts`
- Create: `apps/web/drizzle/0004_templates_community.sql` (generated), `apps/web/src/server/templates/repository.ts`, `apps/web/src/server/templates/seed.ts`, `apps/web/src/server/templates/seed.test.ts`, `apps/web/scripts/seed.ts`
- Modify: `apps/web/tests/support/docs.ts`, `apps/web/tests/support/factories.ts`, `docs/decisions.md`

**Interfaces:**
- Produces:
  - `assets.templateId`.
  - `TemplateCard`, `RankCursor`, `GalleryQuery`.
  - `searchTextFor(title, tags): string`.
  - `getTemplateCard(db, id): Promise<TemplateCard | undefined>`.
  - `listTemplates(db, q: GalleryQuery): Promise<TemplateCard[]>`.
  - `listTemplatesByStatus(db, q)`.
  - `getTemplateVersion(db, templateId, version)`.
  - `insertTemplate(db, values): Promise<TemplateRow>`.
  - `insertTemplateVersion(db, values): Promise<void>`.
  - `seedTemplateId(slug): string`.
  - `loadSeedTemplates(db, docs, now): Promise<SeedResult>`.
- Test support: `templateDoc(opts)`, `createTemplate(db, overrides)`.

- [ ] **Step 1: Schema changes**

In `apps/web/src/server/db/schema.ts`, add `type AnyPgColumn` to the `drizzle-orm/pg-core` import:

```ts
import { boolean, check, date, index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
```

In `assets`, after `height`, add the column:

```ts
    /** Set on the system-owned public copies a published template uses; they go when it goes. */
    templateId: uuid("template_id").references((): AnyPgColumn => templates.id, { onDelete: "cascade" }),
```

and in its index/check list, add:

```ts
    index("assets_template_idx").on(t.templateId),
    check("assets_template_copy_check", sql`${t.templateId} is null or (${t.ownerId} is null and ${t.visibility} = 'public')`),
```

In `templates`, add to the index list:

```ts
    index("templates_popular_idx").on(t.status, t.usesCount, t.id),
```

- [ ] **Step 2: Generate the migration**

Run: `corepack pnpm --filter @vash/web exec drizzle-kit generate --name templates_community`

Expected: `apps/web/drizzle/0004_templates_community.sql` containing only these additive statements:
- `ALTER TABLE "assets" ADD COLUMN "template_id" uuid`
- the `assets_template_id_templates_id_fk` foreign key with `ON DELETE cascade`
- `CREATE INDEX "assets_template_idx"`
- `CREATE INDEX "templates_popular_idx"`
- `ALTER TABLE "assets" ADD CONSTRAINT "assets_template_copy_check"`

Read the file. If it contains anything else, stop and investigate.

- [ ] **Step 3: Test support**

Append to `apps/web/tests/support/docs.ts`:

```ts
/** A valid, lint-clean template: an editable heading and one frame (a placeholder unless it holds `photoAssetId`). */
export function templateDoc(opts: { title?: string; heading?: string; photoAssetId?: string } = {}): Doc {
  const doc = createEmptyDoc({ id: "draft", kind: "template", title: opts.title ?? "Birthday post", format: "ig-post" });
  doc.nodes.heading = {
    id: "heading",
    type: "text",
    name: "Heading",
    transform: { x: 540, y: 900, rotation: 0, scaleX: 1, scaleY: 1 },
    width: 900,
    height: 120,
    opacity: 1,
    visible: true,
    lock: "content-only",
    content: opts.heading ?? "Happy birthday!",
    font: { family: "Poppins", weight: 700, style: "normal" },
    size: 72,
    color: "#16161A",
    align: "center",
    lineHeight: 1.2,
    letterSpacing: 0,
    fit: "shrink",
    maxChars: 200,
  };
  doc.nodes.photo1 = {
    id: "photo1",
    type: "frame",
    name: "Photo",
    transform: { x: 540, y: 400, rotation: 0, scaleX: 1, scaleY: 1 },
    width: 800,
    height: 600,
    opacity: 1,
    visible: true,
    lock: "content-only",
    shape: { kind: "rect", cornerRadius: 0 },
    content: opts.photoAssetId ? { assetId: opts.photoAssetId, offsetX: 0, offsetY: 0, scale: 1 } : null,
    filters: defaultFilters(),
    placeholder: !opts.photoAssetId,
  };
  doc.root.push("photo1", "heading");
  if (opts.photoAssetId) doc.assets[opts.photoAssetId] = { id: opts.photoAssetId, kind: "photo", mime: "image/jpeg", width: 1200, height: 900 };
  return doc;
}
```

In `apps/web/tests/support/factories.ts`:
- Change the schema import to `import { assets, designs, folders, templates, templateVersions, user } from "@/server/db/schema";`.
- Add `import type { Doc } from "@vash/schema";` and `import { templateDoc } from "./docs";`.
- Append:

```ts
/** A template row plus its version 1. Seed-style (no author) unless `authorId` is given. */
export async function createTemplate(db: Db, overrides: Partial<typeof templates.$inferInsert> & { doc?: Doc } = {}) {
  const { doc: givenDoc, ...values } = overrides;
  const id = values.id ?? randomUUID();
  const title = values.title ?? "Birthday post";
  const tags = values.tags ?? ["party"];
  const [row] = await db
    .insert(templates)
    .values({ id, authorId: null, title, category: "birthday", tags, format: "ig-post", width: 1080, height: 1080, searchText: [title, ...tags].join(" "), ...values })
    .returning();
  if (!row) throw new Error("template insert returned nothing");
  await db.insert(templateVersions).values({ templateId: id, version: row.currentVersion, doc: { ...(givenDoc ?? templateDoc({ title })), id }, createdAt: row.createdAt });
  return row;
}

export async function createDesign(db: Db, ownerId: string, doc: Doc, overrides: Partial<typeof designs.$inferInsert> = {}) {
  const [row] = await db.insert(designs).values({ ownerId, title: doc.meta.title, doc, ...overrides }).returning();
  if (!row) throw new Error("design insert returned nothing");
  return row;
}
```

- [ ] **Step 4: Write the failing seed test**

Create `apps/web/src/server/templates/seed.test.ts`:

```ts
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
    expect(await loadSeedTemplates(t.db, docs, NOW)).toEqual({ created: 20, updated: 0, unchanged: 0 });
    const rows = await t.db.select().from(templates);
    expect(rows).toHaveLength(20);
    for (const row of rows) expect(row).toMatchObject({ authorId: null, status: "published", currentVersion: 1, featured: false, usesCount: 0 });
    const first = docs[0]!;
    const [row] = await t.db.select().from(templates).where(eq(templates.id, seedTemplateId(first.id)));
    expect(row).toMatchObject({ title: first.meta.title, category: first.meta.category, format: first.meta.format, width: first.artboard.width });
    expect(row!.searchText).toBe([first.meta.title, ...first.meta.tags].join(" "));
    const [version] = await t.db.select().from(templateVersions).where(eq(templateVersions.templateId, row!.id));
    expect(version!.doc.id).toBe(row!.id);

    expect(await loadSeedTemplates(t.db, seedDocs(), NOW)).toEqual({ created: 0, updated: 0, unchanged: 20 });
    expect(await t.db.select().from(templateVersions)).toHaveLength(20);
  });

  it("adds a version when a seed changes, keeping the old version and the counters", async () => {
    const docs = seedDocs();
    const id = seedTemplateId(docs[0]!.id);
    await t.db.update(templates).set({ usesCount: 7, featured: true }).where(eq(templates.id, id));
    docs[0] = { ...docs[0]!, meta: { ...docs[0]!.meta, title: "Renamed seed" } };
    expect(await loadSeedTemplates(t.db, docs, NOW)).toEqual({ created: 0, updated: 1, unchanged: 19 });
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
```

- [ ] **Step 5: Run it to see it fail**

Run: `corepack pnpm --filter @vash/web exec vitest run src/server/templates/seed.test.ts`
Expected: FAIL, because `./seed` doesn't exist.

- [ ] **Step 6: Write the repository**

Create `apps/web/src/server/templates/repository.ts`:

```ts
import { and, desc, eq, sql } from "drizzle-orm";
import { templates, templateVersions, user } from "../db/schema";
import type { Db } from "../db/types";
import type { Cursor } from "../http/cursor";

export type TemplateRow = typeof templates.$inferSelect;
export type TemplateVersionRow = typeof templateVersions.$inferSelect;

/** A template as lists and detail pages show it: its row, author and current thumbnail. */
export interface TemplateCard {
  id: string;
  authorId: string | null;
  title: string;
  description: string;
  category: string;
  tags: string[];
  format: string;
  width: number;
  height: number;
  status: "published" | "hidden";
  featured: boolean;
  usesCount: number;
  currentVersion: number;
  createdAt: Date;
  updatedAt: Date;
  authorHandle: string | null;
  authorName: string | null;
  thumbnailAssetId: string | null;
}

export interface RankCursor {
  uses: number;
  id: string;
}

interface GalleryFilters {
  search?: string;
  category?: string;
  format?: string;
  authorId?: string;
  limit: number;
}
export type GalleryQuery = GalleryFilters & ({ sort: "new" | "featured"; after?: Cursor } | { sort: "popular"; after?: RankCursor });

/** Title and tags: the only text the gallery search looks at (spec §9.2). */
export const searchTextFor = (title: string, tags: readonly string[]) => [title, ...tags].join(" ");

const cardColumns = {
  id: templates.id,
  authorId: templates.authorId,
  title: templates.title,
  description: templates.description,
  category: templates.category,
  tags: templates.tags,
  format: templates.format,
  width: templates.width,
  height: templates.height,
  status: templates.status,
  featured: templates.featured,
  usesCount: templates.usesCount,
  currentVersion: templates.currentVersion,
  createdAt: templates.createdAt,
  updatedAt: templates.updatedAt,
  authorHandle: user.handle,
  authorName: user.name,
  thumbnailAssetId: templateVersions.thumbnailAssetId,
};

const cards = (db: Db) =>
  db
    .select(cardColumns)
    .from(templates)
    .leftJoin(user, eq(user.id, templates.authorId))
    .leftJoin(templateVersions, and(eq(templateVersions.templateId, templates.id), eq(templateVersions.version, templates.currentVersion)));

export async function getTemplateCard(db: Db, id: string): Promise<TemplateCard | undefined> {
  const [row] = await cards(db).where(eq(templates.id, id));
  return row;
}

/** Published templates only. Search uses the GIN index on to_tsvector('simple', search_text). */
export function listTemplates(db: Db, q: GalleryQuery): Promise<TemplateCard[]> {
  const keyset =
    q.sort === "popular"
      ? q.after && sql`(${templates.usesCount}, ${templates.id}) < (${q.after.uses}, ${q.after.id}::uuid)`
      : q.after && sql`(${templates.createdAt}, ${templates.id}) < (${q.after.at}::timestamptz, ${q.after.id}::uuid)`;
  return cards(db)
    .where(
      and(
        eq(templates.status, "published"),
        q.sort === "featured" ? eq(templates.featured, true) : undefined,
        q.category ? eq(templates.category, q.category) : undefined,
        q.format ? eq(templates.format, q.format) : undefined,
        q.authorId ? eq(templates.authorId, q.authorId) : undefined,
        q.search ? sql`to_tsvector('simple', ${templates.searchText}) @@ plainto_tsquery('simple', ${q.search})` : undefined,
        keyset || undefined,
      ),
    )
    .orderBy(...(q.sort === "popular" ? [desc(templates.usesCount), desc(templates.id)] : [desc(templates.createdAt), desc(templates.id)]))
    .limit(q.limit + 1);
}

/** Any status, newest first: the moderation screen's Hidden and Featured tabs. */
export function listTemplatesByStatus(db: Db, q: { status: TemplateRow["status"]; featured?: boolean; after?: Cursor; limit: number }): Promise<TemplateCard[]> {
  return cards(db)
    .where(
      and(
        eq(templates.status, q.status),
        q.featured ? eq(templates.featured, true) : undefined,
        q.after ? sql`(${templates.createdAt}, ${templates.id}) < (${q.after.at}::timestamptz, ${q.after.id}::uuid)` : undefined,
      ),
    )
    .orderBy(desc(templates.createdAt), desc(templates.id))
    .limit(q.limit + 1);
}

export async function getTemplateVersion(db: Db, templateId: string, version: number): Promise<TemplateVersionRow | undefined> {
  const [row] = await db
    .select()
    .from(templateVersions)
    .where(and(eq(templateVersions.templateId, templateId), eq(templateVersions.version, version)));
  return row;
}

export async function insertTemplate(db: Db, values: typeof templates.$inferInsert): Promise<TemplateRow> {
  const [row] = await db.insert(templates).values(values).returning();
  return row!;
}

export async function insertTemplateVersion(db: Db, values: typeof templateVersions.$inferInsert): Promise<void> {
  await db.insert(templateVersions).values(values);
}
```

- [ ] **Step 7: Write the seed loader and script**

Create `apps/web/src/server/templates/seed.ts`:

```ts
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { eq } from "drizzle-orm";
import type { Doc } from "@vash/schema";
import { templates } from "../db/schema";
import type { Db } from "../db/types";
import { getTemplateVersion, insertTemplate, insertTemplateVersion, searchTextFor } from "./repository";

/** A stable UUID per seed slug (hash-based, RFC 9562 version 8), so a rerun finds the same row. */
export function seedTemplateId(slug: string): string {
  const hex = createHash("sha256").update(`vash-seed-template:${slug}`).digest("hex").slice(0, 32).split("");
  hex[12] = "8";
  hex[16] = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  const h = hex.join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export interface SeedResult {
  created: number;
  updated: number;
  unchanged: number;
}

/**
 * Upserts system templates (no author). A seed whose document changed gets a new version, so
 * designs made from the old one keep what they copied. Status, featured and use counts are left
 * alone. `docs` must already be valid templates (parseDoc with kind "template").
 */
export async function loadSeedTemplates(db: Db, docs: readonly Doc[], now: Date): Promise<SeedResult> {
  const result: SeedResult = { created: 0, updated: 0, unchanged: 0 };
  for (const seed of docs) {
    const id = seedTemplateId(seed.id);
    const doc: Doc = { ...seed, id };
    const category = doc.meta.category;
    if (!category) throw new Error(`seed template ${seed.id} has no category`);
    const fields = {
      title: doc.meta.title,
      category,
      tags: doc.meta.tags,
      format: doc.meta.format,
      width: doc.artboard.width,
      height: doc.artboard.height,
      searchText: searchTextFor(doc.meta.title, doc.meta.tags),
    };
    await db.transaction(async (tx) => {
      const [current] = await tx.select({ version: templates.currentVersion }).from(templates).where(eq(templates.id, id)).for("update");
      if (!current) {
        await insertTemplate(tx, { id, authorId: null, ...fields, createdAt: now, updatedAt: now });
        await insertTemplateVersion(tx, { templateId: id, version: 1, doc, createdAt: now });
        result.created++;
        return;
      }
      const latest = await getTemplateVersion(tx, id, current.version);
      if (latest && isDeepStrictEqual(latest.doc, doc)) {
        result.unchanged++;
        return;
      }
      const version = current.version + 1;
      await insertTemplateVersion(tx, { templateId: id, version, doc, createdAt: now });
      await tx.update(templates).set({ ...fields, currentVersion: version, updatedAt: now }).where(eq(templates.id, id));
      result.updated++;
    });
  }
  return result;
}
```

Create `apps/web/scripts/seed.ts` (the existing `db:seed` script already points here):

```ts
import { readdirSync, readFileSync } from "node:fs";
import { parseDoc, type Doc } from "@vash/schema";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../src/server/db/schema";
import { loadSeedTemplates } from "../src/server/templates/seed";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const dir = new URL("../templates/seed/", import.meta.url);
const docs: Doc[] = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((file) => {
    const parsed = parseDoc(JSON.parse(readFileSync(new URL(file, dir), "utf8")), { kind: "template" });
    if (!parsed.ok) throw new Error(`${file}: ${JSON.stringify(parsed.issues.slice(0, 5))}`);
    return parsed.doc;
  });

const pool = new Pool({ connectionString: url, max: 1 });
try {
  const r = await loadSeedTemplates(drizzle(pool, { schema }), docs, new Date());
  console.log(`seed templates: ${r.created} created, ${r.updated} updated, ${r.unchanged} unchanged`);
} finally {
  await pool.end();
}
```

- [ ] **Step 8: Run the tests and typecheck**

Run: `corepack pnpm --filter @vash/web exec vitest run src/server/templates && corepack pnpm --filter @vash/web typecheck`
Expected: 3 passed, no type errors. If `drizzle(pool, { schema })` isn't assignable to `Db`, cast it as `createDb` does in `db/client.ts`.

- [ ] **Step 9: Record the decision**

Append to the table in `docs/decisions.md`:

```
| 31 | 2026-09-26 | **Seed templates load with `pnpm --filter @vash/web db:seed`** (`scripts/seed.ts`): each slug maps to a stable hash-based UUID; a changed seed becomes a new version (designs keep what they copied); status, featured and use counts are never reset. `assets.template_id` links a published template's public copies; a check keeps such rows system-owned and public. | Idempotent seeding for every environment; one migration for Plan 3's schema. |
```

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/server/db/schema.ts apps/web/drizzle apps/web/src/server/templates apps/web/scripts/seed.ts apps/web/tests/support docs/decisions.md
git commit -m "feat(web): template repository, idempotent seed loader, assets.template_id"
```

---

### Task 2: Gallery and template detail

**Files:**
- Create: `apps/web/src/server/templates/view.ts`, `apps/web/src/server/templates/gallery.ts`, `apps/web/src/server/templates/handlers.ts`, `apps/web/src/server/templates/gallery.test.ts`, `apps/web/src/app/api/templates/route.ts`, `apps/web/src/app/api/templates/[id]/route.ts`
- Modify: `apps/web/src/server/context.ts`, `docs/decisions.md`

**Interfaces:**
- Consumes: `listTemplates`, `getTemplateCard`, `getTemplateVersion`, `TemplateCard`, `RankCursor` (Task 1).
- Produces:
  - `canSee(card, viewer): boolean`.
  - `toTemplateJson(card)`.
  - `galleryPage(db, params): Promise<{ items; nextCursor }>`.
  - `templateHandlers(deps)` with `list` and `get`.
  - `app.templates`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/server/templates/gallery.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../../tests/support/db";
import { testDeps } from "../../../tests/support/deps";
import { createTemplate, createUser } from "../../../tests/support/factories";
import { call } from "../../../tests/support/invoke";
import { templates } from "../db/schema";
import { templateHandlers } from "./handlers";

let t: TestDb;
let h: ReturnType<typeof templateHandlers>;
beforeAll(async () => {
  t = await createTestDb();
  h = templateHandlers(testDeps(t.db));
});
beforeEach(async () => {
  await t.db.delete(templates);
});
afterAll(() => t.close());

const list = (query = "") => call(h.list, { path: `/api/templates${query}` });
const ids = (res: { body: { items: { id: string }[] } }) => res.body.items.map((i) => i.id);
const handle = () => `u_${randomUUID().slice(0, 8)}`;

describe("GET /api/templates", () => {
  it("lists published templates newest first, a page at a time", async () => {
    const a = await createTemplate(t.db, { createdAt: new Date("2026-09-01T00:00:00Z") });
    const b = await createTemplate(t.db, { createdAt: new Date("2026-09-02T00:00:00Z") });
    const c = await createTemplate(t.db, { createdAt: new Date("2026-09-03T00:00:00Z") });
    await createTemplate(t.db, { status: "hidden", createdAt: new Date("2026-09-04T00:00:00Z") });
    const first = await list("?sort=new&limit=2");
    expect(first.status).toBe(200);
    expect(ids(first)).toEqual([c.id, b.id]);
    const second = await list(`?sort=new&limit=2&cursor=${first.body.nextCursor}`);
    expect(ids(second)).toEqual([a.id]);
    expect(second.body.nextCursor).toBeNull();
  });

  it("sorts by uses (the default), breaking ties by id, without repeats across pages", async () => {
    const rows = await Promise.all([5, 9, 5, 0].map((usesCount) => createTemplate(t.db, { usesCount })));
    const expected = [...rows].sort((x, y) => y.usesCount - x.usesCount || (x.id < y.id ? 1 : -1)).map((r) => r.id);
    const seen: string[] = [];
    let cursor = "";
    for (let i = 0; i < 5; i++) {
      const res = await list(`?limit=1${cursor ? `&cursor=${cursor}` : ""}`);
      seen.push(...ids(res));
      if (!res.body.nextCursor) break;
      cursor = res.body.nextCursor;
    }
    expect(seen).toEqual(expected);
  });

  it("filters by category, format and featured, and searches titles and tags", async () => {
    const party = await createTemplate(t.db, { title: "Sunset Birthday Bash", tags: ["party"], category: "birthday", format: "ig-post" });
    const menu = await createTemplate(t.db, { title: "Menu", tags: ["food", "dinner"], category: "food", format: "poster", width: 1240, height: 1754, featured: true });
    expect(ids(await list("?category=food"))).toEqual([menu.id]);
    expect(ids(await list("?format=ig-post"))).toEqual([party.id]);
    expect(ids(await list("?sort=featured"))).toEqual([menu.id]);
    expect(ids(await list("?q=birthday"))).toEqual([party.id]);
    expect(ids(await list("?q=DINNER"))).toEqual([menu.id]);
    expect(ids(await list("?q=nothing-like-this"))).toEqual([]);
  });

  it.each(["a & b | !c:*", "'); drop table templates; --", "🎉", "x".repeat(100)])("treats search %j as words, never as query syntax", async (q) => {
    await createTemplate(t.db);
    expect((await list(`?q=${encodeURIComponent(q)}`)).status).toBe(200);
  });

  it.each(["?q=" + "x".repeat(101), "?category=weddings", "?format=a4", "?sort=random", "?cursor=abc", "?limit=51"])("rejects %s with 400", async (query) => {
    expect((await list(query)).status).toBe(400);
  });

  it("rejects a date cursor on the popular sort", async () => {
    await createTemplate(t.db);
    await createTemplate(t.db);
    const byDate = await list("?sort=new&limit=1");
    expect((await list(`?sort=popular&cursor=${byDate.body.nextCursor}`)).status).toBe(400);
  });

  it("shows the author's handle and name, never their id, and null for system templates", async () => {
    const alice = await createUser(t.db, { handle: handle(), name: "Alice" });
    await createTemplate(t.db, { authorId: alice.id, createdAt: new Date("2026-09-02T00:00:00Z") });
    await createTemplate(t.db, { createdAt: new Date("2026-09-01T00:00:00Z") });
    const [mine, seed] = (await list("?sort=new")).body.items;
    expect(mine.author).toEqual({ handle: alice.handle, name: "Alice" });
    expect(seed.author).toBeNull();
    expect(Object.keys(mine)).not.toContain("authorId");
    expect(JSON.stringify(mine)).not.toContain(alice.id);
  });
});

describe("GET /api/templates/:id", () => {
  it("returns a published template with its current document to anyone", async () => {
    const tpl = await createTemplate(t.db, { title: "Party" });
    const res = await call(h.get, { params: { id: tpl.id } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: tpl.id, title: "Party", currentVersion: 1, status: "published" });
    expect(res.body.doc).toMatchObject({ id: tpl.id, kind: "template" });
  });

  it("shows a hidden template only to its author and admins", async () => {
    const alice = await createUser(t.db, { handle: handle() });
    const bob = await createUser(t.db);
    const admin = await createUser(t.db, { role: "admin" });
    const tpl = await createTemplate(t.db, { authorId: alice.id, status: "hidden" });
    expect((await call(h.get, { params: { id: tpl.id } })).status).toBe(404);
    expect((await call(h.get, { as: bob, params: { id: tpl.id } })).status).toBe(404);
    expect((await call(h.get, { as: alice, params: { id: tpl.id } })).body.status).toBe("hidden");
    expect((await call(h.get, { as: admin, params: { id: tpl.id } })).status).toBe(200);
  });

  it("answers 404 for unknown and malformed ids", async () => {
    expect((await call(h.get, { params: { id: randomUUID() } })).status).toBe(404);
    expect((await call(h.get, { params: { id: "post-editorial-bloom" } })).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm --filter @vash/web exec vitest run src/server/templates/gallery.test.ts`
Expected: FAIL, because `./handlers` doesn't exist.

- [ ] **Step 3: Implement**

Create `apps/web/src/server/templates/view.ts`:

```ts
import type { CurrentUser } from "../deps";
import type { TemplateCard } from "./repository";

/** Published templates are public; a hidden one stays visible to its author and to admins. */
export function canSee(card: Pick<TemplateCard, "status" | "authorId">, viewer: Pick<CurrentUser, "id" | "role"> | null): boolean {
  return card.status === "published" || (viewer !== null && (viewer.id === card.authorId || viewer.role === "admin"));
}

/** Public JSON: the author appears by handle and name only, never by account id. */
export const toTemplateJson = (t: TemplateCard) => ({
  id: t.id,
  title: t.title,
  description: t.description,
  category: t.category,
  tags: t.tags,
  format: t.format,
  width: t.width,
  height: t.height,
  status: t.status,
  featured: t.featured,
  usesCount: t.usesCount,
  currentVersion: t.currentVersion,
  thumbnailAssetId: t.thumbnailAssetId,
  author: t.authorId ? { handle: t.authorHandle, name: t.authorName } : null,
  createdAt: t.createdAt.toISOString(),
  updatedAt: t.updatedAt.toISOString(),
});
```

Create `apps/web/src/server/templates/gallery.ts`:

```ts
import type { Db } from "../db/types";
import { decodeCursor, encodeCursor } from "../http/cursor";
import { isUuid } from "../http/ids";
import { badRequest } from "../http/problem";
import { listTemplates, type RankCursor } from "./repository";
import { toTemplateJson } from "./view";

export type GallerySort = "popular" | "new" | "featured";

export const encodeRankCursor = (c: RankCursor) => Buffer.from(JSON.stringify([c.uses, c.id])).toString("base64url");

export function decodeRankCursor(value: string): RankCursor {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (Array.isArray(parsed) && parsed.length === 2 && Number.isSafeInteger(parsed[0]) && parsed[0] >= 0 && typeof parsed[1] === "string" && isUuid(parsed[1])) {
      return { uses: parsed[0], id: parsed[1] };
    }
  } catch {
    // fall through
  }
  throw badRequest("The cursor is invalid.");
}

/** One page of published templates. The popular sort pages by (uses, id), the others by (created, id). */
export async function galleryPage(
  db: Db,
  p: { q?: string; category?: string; format?: string; authorId?: string; sort: GallerySort; cursor?: string; limit: number },
) {
  const filters = { search: p.q, category: p.category, format: p.format, authorId: p.authorId, limit: p.limit };
  const rows =
    p.sort === "popular"
      ? await listTemplates(db, { ...filters, sort: "popular", after: p.cursor ? decodeRankCursor(p.cursor) : undefined })
      : await listTemplates(db, { ...filters, sort: p.sort, after: p.cursor ? decodeCursor(p.cursor) : undefined });
  const hasMore = rows.length > p.limit;
  const items = hasMore ? rows.slice(0, p.limit) : rows;
  const last = items.at(-1);
  const nextCursor =
    !hasMore || !last
      ? null
      : p.sort === "popular"
        ? encodeRankCursor({ uses: last.usesCount, id: last.id })
        : encodeCursor({ at: last.createdAt.toISOString(), id: last.id });
  return { items: items.map(toTemplateJson), nextCursor };
}
```

Create `apps/web/src/server/templates/handlers.ts`:

```ts
import { CATEGORIES, FORMAT_KEYS } from "@vash/schema";
import { z } from "zod";
import type { Deps } from "../deps";
import { readQuery } from "../http/body";
import { pageQuery } from "../http/cursor";
import { endpoint } from "../http/endpoint";
import { parseId } from "../http/ids";
import { notFound } from "../http/problem";
import { RATE_LIMITS } from "../rate-limit/rules";
import { galleryPage } from "./gallery";
import * as repo from "./repository";
import { canSee, toTemplateJson } from "./view";

const publicRead = { name: "publicRead", rule: RATE_LIMITS.publicRead, by: "ip" } as const;

const GalleryParams = pageQuery.extend({
  q: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((v) => v || undefined),
  category: z.string().refine((c) => CATEGORIES.includes(c), "Unknown category.").optional(),
  format: z.string().refine((f) => (FORMAT_KEYS as readonly string[]).includes(f), "Unknown format.").optional(),
  sort: z.enum(["popular", "new", "featured"]).default("popular"),
});

export function templateHandlers(deps: Deps) {
  return {
    list: endpoint(deps, { auth: "none", rateLimit: publicRead }, async ({ req }) => {
      return Response.json(await galleryPage(deps.db, readQuery(req, GalleryParams)));
    }),

    get: endpoint(deps, { auth: "optional", rateLimit: publicRead }, async ({ user, params }) => {
      const card = await repo.getTemplateCard(deps.db, parseId(params.id));
      if (!card || !canSee(card, user)) throw notFound();
      const version = await repo.getTemplateVersion(deps.db, card.id, card.currentVersion);
      if (!version) throw notFound();
      return Response.json({ ...toTemplateJson(card), doc: version.doc });
    }),
  };
}
```

Create `apps/web/src/app/api/templates/route.ts`:

```ts
import { route } from "@/server/context";

export const GET = route((app) => app.templates.list);
```

Create `apps/web/src/app/api/templates/[id]/route.ts`:

```ts
import { route } from "@/server/context";

export const GET = route((app) => app.templates.get);
```

In `apps/web/src/server/context.ts`, add `import { templateHandlers } from "./templates/handlers";`, and in `build()`'s returned object add `templates: templateHandlers(deps),` after `me`.

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm --filter @vash/web exec vitest run src/server/templates && corepack pnpm --filter @vash/web typecheck`
Expected: all pass.

- [ ] **Step 5: Record the decision**

Append to `docs/decisions.md`:

```
| 32 | 2026-09-26 | **Gallery sorts:** `popular` (default; uses, then id), `new` (created, then id) and `featured` (featured only, newest first), each with its own keyset cursor. Search is `plainto_tsquery('simple', q)` over title + tags, so user input is always plain words; `q` is capped at 100 characters. Template JSON names the author by handle and name only. | Matches the brief's sort menu; no query-syntax injection or errors from search input; account ids stay private. |
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/server/templates apps/web/src/app/api/templates apps/web/src/server/context.ts docs/decisions.md
git commit -m "feat(web): template gallery with search, filters and sorts; template detail"
```

---

### Task 3: Use a template

**Files:**
- Create: `apps/web/src/server/templates/use.ts`, `apps/web/src/server/templates/use.test.ts`, `apps/web/src/app/api/templates/[id]/use/route.ts`
- Modify: `apps/web/src/server/templates/handlers.ts`, `apps/web/src/server/designs/handlers.ts`

**Interfaces:**
- Consumes: `getTemplateCard`, `getTemplateVersion`, `canSee`, `insertWithinQuota`, `insertDesign`.
- Produces:
  - `useTemplate(ctx, viewer, templateId): Promise<DesignRow>`.
  - `toDesignJson(row)`, exported from `designs/handlers.ts`.
  - `templateHandlers(...).use`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/server/templates/use.test.ts`:

```ts
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
```

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm --filter @vash/web exec vitest run src/server/templates/use.test.ts`
Expected: FAIL, because `h.use` is undefined.

- [ ] **Step 3: Export the design JSON shape**

In `apps/web/src/server/designs/handlers.ts`:
- Rename `const full = (d: repo.DesignRow) =>` to `export const toDesignJson = (d: repo.DesignRow) =>`.
- Replace every `full(` call in that file with `toDesignJson(`. There are six: create, get, save, patch, duplicate, plus the definition.

- [ ] **Step 4: Implement**

Create `apps/web/src/server/templates/use.ts`:

```ts
import { randomUUID } from "node:crypto";
import { parseDoc, type Doc } from "@vash/schema";
import { eq, sql } from "drizzle-orm";
import { isForeignKeyViolation } from "../db/errors";
import { templates, templateUses } from "../db/schema";
import type { Db } from "../db/types";
import type { CurrentUser } from "../deps";
import { insertDesign, type DesignRow } from "../designs/repository";
import { notFound } from "../http/problem";
import { insertWithinQuota } from "../quotas";
import { getTemplateCard, getTemplateVersion } from "./repository";
import { canSee } from "./view";

/** Spec §8.2: copies the current version into a new design; a signed-in use counts once per user per template per UTC day. */
export async function useTemplate(ctx: { db: Db; now: () => Date }, viewer: CurrentUser, templateId: string): Promise<DesignRow> {
  const card = await getTemplateCard(ctx.db, templateId);
  if (!card || !canSee(card, viewer)) throw notFound();
  const version = await getTemplateVersion(ctx.db, templateId, card.currentVersion);
  if (!version) throw notFound();
  // Stored versions may predate a schema migration; parseDoc brings them up to date.
  const parsed = parseDoc(version.doc, { kind: "template" });
  if (!parsed.ok) throw new Error(`template ${templateId} version ${version.version} no longer validates`);

  const designId = randomUUID();
  const now = ctx.now();
  const doc: Doc = { ...parsed.doc, id: designId, kind: "design" };
  try {
    return await insertWithinQuota(ctx.db, viewer.id, "designs", async (tx) => {
      const design = await insertDesign(tx, {
        id: designId,
        ownerId: viewer.id,
        folderId: null,
        title: doc.meta.title,
        doc,
        sourceTemplateId: templateId,
        sourceTemplateVersion: version.version,
        createdAt: now,
        updatedAt: now,
      });
      const counted = await tx
        .insert(templateUses)
        .values({ templateId, userId: viewer.id, day: now.toISOString().slice(0, 10) })
        .onConflictDoNothing()
        .returning({ day: templateUses.day });
      if (counted.length > 0) await tx.update(templates).set({ usesCount: sql`${templates.usesCount} + 1` }).where(eq(templates.id, templateId));
      return design;
    });
  } catch (err) {
    // The template went (its author deleted their account) after we read it.
    if (isForeignKeyViolation(err)) throw notFound();
    throw err;
  }
}
```

In `apps/web/src/server/templates/handlers.ts`:
- Add imports: `import { toDesignJson } from "../designs/handlers";` and `import { useTemplate } from "./use";`.
- Add `const createLimit = { name: "designCreate", rule: RATE_LIMITS.designCreate, by: "user" } as const;` next to `publicRead`.
- Add to the returned object:

```ts
    use: endpoint(deps, { auth: "user", rateLimit: createLimit }, async ({ user, params }) => {
      const design = await useTemplate({ db: deps.db, now: deps.now }, user, parseId(params.id));
      return Response.json(toDesignJson(design), { status: 201 });
    }),
```

Create `apps/web/src/app/api/templates/[id]/use/route.ts`:

```ts
import { route } from "@/server/context";

export const POST = route((app) => app.templates.use);
```

- [ ] **Step 5: Run the tests**

Run: `corepack pnpm --filter @vash/web exec vitest run src/server/templates src/server/designs && corepack pnpm --filter @vash/web typecheck`
Expected: all pass. The designs tests still pass after the rename.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/server/templates apps/web/src/server/designs/handlers.ts apps/web/src/app/api/templates
git commit -m "feat(web): use a template as a new design, counting once per user per day"
```

---

### Task 4: Publish preflight (privacy scrub preview)

**Files:**
- Create: `apps/web/src/server/templates/draft.ts`, `apps/web/src/server/templates/preflight.test.ts`, `apps/web/src/app/api/templates/preflight/route.ts`
- Modify: `apps/web/src/server/templates/handlers.ts`, `docs/decisions.md`

**Interfaces:**
- Consumes:
  - `getDesign`, `findUnusableAssets`, `AssetRow`.
  - From `@vash/schema`: `scrubForPublish`, `lintTemplate`, `parseDoc`, `scanForPii`.
- Produces:
  - `PUBLISH_LIMITS = { keptPhotos: 10, descriptionChars: 1000 }`.
  - `DraftAnalysis { design, doc, photos, kept, issues, pii }`.
  - `analyzeDraft(db, authorId, designId, keep): Promise<DraftAnalysis>`.
  - `templateHandlers(...).preflight`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/server/templates/preflight.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../../tests/support/db";
import { testDeps } from "../../../tests/support/deps";
import { emptyDoc, templateDoc } from "../../../tests/support/docs";
import { createAsset, createDesign, createUser } from "../../../tests/support/factories";
import { call } from "../../../tests/support/invoke";
import { templateHandlers } from "./handlers";

let t: TestDb;
let h: ReturnType<typeof templateHandlers>;
beforeAll(async () => {
  t = await createTestDb();
  h = templateHandlers(testDeps(t.db));
});
afterAll(() => t.close());

const preflight = (as: { id: string } | null, body: Record<string, unknown>) => call(h.preflight, { method: "POST", as, body });

describe("POST /api/templates/preflight", () => {
  it("lists the draft's photos and scrubs every one that isn't kept", async () => {
    const alice = await createUser(t.db);
    const photo = await createAsset(t.db, { ownerId: alice.id });
    const draft = await createDesign(t.db, alice.id, templateDoc({ photoAssetId: photo.id }));
    const res = await preflight(alice, { designId: draft.id });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, issues: [], pii: [], photos: [{ assetId: photo.id, nodeIds: ["photo1"], yours: true }] });
    expect((await preflight(alice, { designId: draft.id, keep: [photo.id] })).body.ok).toBe(true);
  });

  it("warns about emails and phone numbers without blocking, and never echoes them whole", async () => {
    const alice = await createUser(t.db);
    const draft = await createDesign(t.db, alice.id, templateDoc({ heading: "Call 98765 43210 or mail riya@example.com" }));
    const res = await preflight(alice, { designId: draft.id });
    expect(res.body.ok).toBe(true);
    expect(res.body.pii.map((p: { kind: string }) => p.kind).sort()).toEqual(["email", "phone"]);
    expect(JSON.stringify(res.body)).not.toContain("riya@example.com");
  });

  it("reports template lint problems", async () => {
    const alice = await createUser(t.db);
    const doc = templateDoc();
    doc.nodes.heading!.lock = "locked";
    Object.assign(doc.nodes.photo1!, { placeholder: false });
    const draft = await createDesign(t.db, alice.id, doc);
    const res = await preflight(alice, { designId: draft.id });
    expect(res.body.ok).toBe(false);
    expect(res.body.issues.length).toBeGreaterThan(0);
  });

  it("only keeps the author's own ready photos that are in the draft", async () => {
    const alice = await createUser(t.db);
    const bob = await createUser(t.db);
    const bobs = await createAsset(t.db, { ownerId: bob.id });
    const pending = await createAsset(t.db, { ownerId: alice.id, status: "pending" });
    const withBobs = await createDesign(t.db, alice.id, templateDoc({ photoAssetId: bobs.id }));
    const withPending = await createDesign(t.db, alice.id, templateDoc({ photoAssetId: pending.id }));
    const foreign = await preflight(alice, { designId: withBobs.id, keep: [bobs.id] });
    expect(foreign.status).toBe(422);
    expect(foreign.body.detail).toMatch(/your own photos/);
    expect((await preflight(alice, { designId: withBobs.id })).body.photos).toEqual([{ assetId: bobs.id, nodeIds: ["photo1"], yours: false }]);
    expect((await preflight(alice, { designId: withPending.id, keep: [pending.id] })).status).toBe(422);
    const absent = await preflight(alice, { designId: withBobs.id, keep: [randomUUID()] });
    expect(absent.status).toBe(422);
    expect(absent.body.detail).toMatch(/in this template/);
  });

  it("only accepts the caller's template drafts", async () => {
    const alice = await createUser(t.db);
    const bob = await createUser(t.db);
    const plain = await createDesign(t.db, alice.id, emptyDoc());
    const draft = await createDesign(t.db, alice.id, templateDoc());
    expect((await preflight(alice, { designId: plain.id })).status).toBe(422);
    expect((await preflight(bob, { designId: draft.id })).status).toBe(404);
    expect((await preflight(null, { designId: draft.id })).status).toBe(401);
    expect((await preflight(alice, { designId: draft.id, keep: Array.from({ length: 11 }, () => randomUUID()) })).status).toBe(400);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm --filter @vash/web exec vitest run src/server/templates/preflight.test.ts`
Expected: FAIL, because `h.preflight` is undefined.

- [ ] **Step 3: Implement**

Create `apps/web/src/server/templates/draft.ts`:

```ts
import { lintTemplate, parseDoc, scanForPii, scrubForPublish, type Doc, type PiiFinding, type ValidationIssue } from "@vash/schema";
import { and, eq, inArray } from "drizzle-orm";
import { findUnusableAssets, type AssetRow } from "../assets/repository";
import { assets } from "../db/schema";
import type { Db } from "../db/types";
import { getDesign, type DesignRow } from "../designs/repository";
import { isUuid } from "../http/ids";
import { notFound, unprocessable } from "../http/problem";

/** Not in the spec: bounds how much public storage one publish can add. */
export const PUBLISH_LIMITS = { keptPhotos: 10, descriptionChars: 1000 } as const;

export interface DraftPhoto {
  assetId: string;
  nodeIds: string[];
  /** The author's own ready photo, so it may be kept. */
  yours: boolean;
}

export interface DraftAnalysis {
  design: DesignRow;
  /** The draft after the privacy scrub: every photo not kept is now an empty placeholder. */
  doc: Doc;
  photos: DraftPhoto[];
  /** The author's own ready photos that stay in the template. */
  kept: AssetRow[];
  issues: ValidationIssue[];
  pii: PiiFinding[];
}

/** Spec §8.4 steps 2 and 5, without writing anything: what publishing this draft would produce. */
export async function analyzeDraft(db: Db, authorId: string, designId: string, keep: readonly string[]): Promise<DraftAnalysis> {
  const design = await getDesign(db, authorId, designId);
  if (!design) throw notFound();
  if (design.doc.kind !== "template") throw unprocessable("Only template drafts can be published. Open this design in Author Mode first.");

  const frames = new Map<string, string[]>();
  for (const node of Object.values(design.doc.nodes)) {
    if (node.type === "frame" && node.content) frames.set(node.content.assetId, [...(frames.get(node.content.assetId) ?? []), node.id]);
  }
  const candidates = [...frames.keys()].filter(isUuid);
  const own =
    candidates.length === 0
      ? []
      : await db
          .select()
          .from(assets)
          .where(and(inArray(assets.id, candidates), eq(assets.ownerId, authorId), eq(assets.status, "ready"), eq(assets.kind, "photo")));
  const ownById = new Map(own.map((a) => [a.id, a]));

  const kept: AssetRow[] = [];
  for (const id of new Set(keep)) {
    if (!frames.has(id)) throw unprocessable("You can only keep photos that are in this template.", { assetId: id });
    const asset = ownById.get(id);
    if (!asset) throw unprocessable("You can only keep your own photos.", { assetId: id });
    kept.push(asset);
  }

  const doc = scrubForPublish(design.doc, new Set(kept.map((a) => a.id)));
  const parsed = parseDoc(doc, { kind: "template" });
  const issues = parsed.ok ? lintTemplate(parsed.doc) : parsed.issues.slice(0, 50);
  for (const id of await findUnusableAssets(db, authorId, Object.values(doc.assets))) {
    issues.push({ path: `assets.${id}`, message: "can't be published: it isn't yours, a system asset or public" });
  }
  return {
    design,
    doc,
    photos: [...frames].map(([assetId, nodeIds]) => ({ assetId, nodeIds, yours: ownById.has(assetId) })),
    kept,
    issues,
    pii: scanForPii(doc),
  };
}
```

In `apps/web/src/server/templates/handlers.ts`:
- Add imports: `import { readJson, readQuery } from "../http/body";`. Replace the existing `readQuery` import.
- Add `import { analyzeDraft, PUBLISH_LIMITS } from "./draft";`.
- Add the constants:

```ts
const writeLimit = { name: "userWrite", rule: RATE_LIMITS.userWrite, by: "user" } as const;
const Uuid = z.uuid().transform((s) => s.toLowerCase());
const PreflightBody = z.object({ designId: Uuid, keep: z.array(Uuid).max(PUBLISH_LIMITS.keptPhotos).default([]) }).strict();
```

and the endpoint:

```ts
    preflight: endpoint(deps, { auth: "user", rateLimit: writeLimit }, async ({ req, user }) => {
      const body = await readJson(req, PreflightBody);
      const draft = await analyzeDraft(deps.db, user.id, body.designId, body.keep);
      return Response.json({ ok: draft.issues.length === 0, issues: draft.issues, pii: draft.pii, photos: draft.photos });
    }),
```

Create `apps/web/src/app/api/templates/preflight/route.ts`:

```ts
import { route } from "@/server/context";

export const POST = route((app) => app.templates.preflight);
```

(Next resolves the static `preflight` segment before `[id]`.)

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm --filter @vash/web exec vitest run src/server/templates && corepack pnpm --filter @vash/web typecheck`
Expected: all pass.

- [ ] **Step 5: Record the decision**

Append to `docs/decisions.md`:

```
| 33 | 2026-09-26 | **Publishing rules beyond §8.4:** only template drafts (`doc.kind = "template"`) can be published; the author needs a handle; at most 10 kept photos, each the author's own ready photo and only with `ownsKeptPhotos: true`; a thumbnail (the author's own `thumbnail` asset) is required. `POST /api/templates/preflight` runs the same checks without writing, for the Publish Flow's scrub and warnings step. Failed publishes still count toward the 5/day limit, so the UI preflights first. | Bounds public storage per publish; the profile and gallery need a handle; attribution only for photos the author can vouch for. |
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/server/templates apps/web/src/app/api/templates docs/decisions.md
git commit -m "feat(web): publish preflight with privacy scrub preview, lint and PII warnings"
```

---

### Task 5: Publish templates and new versions

**Files:**
- Modify:
  - `packages/schema/src/template.ts`, `packages/schema/src/index.ts`, `packages/schema/src/misc.test.ts`
  - `apps/web/src/server/storage/types.ts`, `apps/web/src/server/storage/s3.ts`, `apps/web/src/server/storage/s3.test.ts`
  - `apps/web/tests/support/storage.ts`
  - `apps/web/src/server/assets/service.ts`, `apps/web/src/server/assets/uploads.test.ts`, `apps/web/src/server/assets/repository.ts`
  - `apps/web/src/server/me/service.ts`
  - `apps/web/src/server/templates/handlers.ts`, `apps/web/src/server/context.ts`
  - `docs/decisions.md`
- Create:
  - `apps/web/src/server/storage/copies.ts`
  - `apps/web/src/server/templates/publish.ts`, `apps/web/src/server/templates/publish.test.ts`
  - `apps/web/src/app/api/templates/[id]/versions/route.ts`
- Modify: `apps/web/src/app/api/templates/route.ts` (add POST).

**Interfaces:**
- Consumes: `analyzeDraft`, `PUBLISH_LIMITS` (Task 4); `insertTemplate`, `insertTemplateVersion`, `getTemplateCard`, `searchTextFor` (Task 1).
- Produces:
  - `replaceAssetIds(doc, ids: ReadonlyMap<string, string>): Doc`, from `@vash/schema`.
  - `ObjectRef { bucket; key }`, and `ObjectStorage.copy(from: ObjectRef, to: ObjectRef)`.
  - `memoryStorage().failCopy: Set<string>`, keyed by source key.
  - `Copy`, `copyAll(db, storage, copies, now)`, `queueObjects(db, refs, now)`.
  - `publishTemplate(ctx, author, input, templateId | null)`.
  - `templateHandlers(deps, storage = null)` with `publish` and `publishVersion`.

- [ ] **Step 1: `replaceAssetIds` test (schema package)**

Add `replaceAssetIds` to the import on line 2 of `packages/schema/src/misc.test.ts`, and append:

```ts
describe("replaceAssetIds", () => {
  it("renames asset ids in frames and the assets map, leaving the input untouched", () => {
    const doc = sampleTemplate();
    const next = replaceAssetIds(doc, new Map([["asset1", "copy1"]]));
    expect(next.nodes.photo1).toMatchObject({ content: { assetId: "copy1" } });
    expect(next.assets).toEqual({ copy1: { ...doc.assets.asset1, id: "copy1" } });
    expect(doc.assets.asset1).toBeDefined();
    expect(replaceAssetIds(doc, new Map())).toEqual(doc);
  });
});
```

Run: `corepack pnpm --filter @vash/schema exec vitest run src/misc.test.ts`. Expected: FAIL, because `replaceAssetIds` isn't exported.

- [ ] **Step 2: Implement `replaceAssetIds`**

Append to `packages/schema/src/template.ts`:

```ts
/** Returns a copy of `doc` with asset ids renamed (old → new) in frames, stickers and the assets map. */
export function replaceAssetIds(doc: Doc, ids: ReadonlyMap<AssetId, AssetId>): Doc {
  const rename = (id: AssetId) => ids.get(id) ?? id;
  const nodes: Doc["nodes"] = {};
  for (const [nodeId, node] of Object.entries(doc.nodes)) {
    if (node.type === "frame" && node.content) nodes[nodeId] = { ...node, content: { ...node.content, assetId: rename(node.content.assetId) } };
    else if (node.type === "sticker") nodes[nodeId] = { ...node, assetId: rename(node.assetId) };
    else nodes[nodeId] = node;
  }
  const assets: Doc["assets"] = {};
  for (const [id, ref] of Object.entries(doc.assets)) assets[rename(id)] = { ...ref, id: rename(id) };
  return { ...doc, nodes, assets };
}
```

In `packages/schema/src/index.ts`, add `replaceAssetIds` to the `./template` export list. Run the schema tests again. Expected: PASS.

- [ ] **Step 3: Cross-bucket copy**

In `apps/web/src/server/storage/types.ts`:
- Add `export interface ObjectRef { bucket: Bucket; key: string }`.
- Replace the `copy` member with:

```ts
  /** Server-side copy, within or across buckets, overwriting `to`. */
  copy(from: ObjectRef, to: ObjectRef): Promise<void>;
```

In `apps/web/src/server/storage/s3.ts`, replace `copy`:

```ts
    async copy(from, to) {
      const CopySource = [bucketName(from.bucket), ...from.key.split("/")].map(encodeURIComponent).join("/");
      await client.send(new CopyObjectCommand({ Bucket: bucketName(to.bucket), Key: to.key, CopySource }));
    },
```

In `apps/web/src/server/storage/s3.test.ts`, replace the copy test body with:

```ts
    await s3Storage(config, client).copy({ bucket: "private", key: "u/user 1/a" }, { bucket: "public", key: "t/tpl/a" });
    expect(sent.map((c) => c.input)).toEqual([{ Bucket: "vash-public", Key: "t/tpl/a", CopySource: "vash-private/u/user%201/a" }]);
```

and rename it `"copies within or across buckets, URL-encoding the source"`.

In `apps/web/tests/support/storage.ts`:
- Add `const failCopy = new Set<string>();`.
- Replace `copy` with:

```ts
    async copy(from, to) {
      if (failCopy.has(from.key)) throw new Error("storage unavailable");
      const bytes = objects.get(id(from.bucket, from.key));
      if (!bytes) throw new Error("NoSuchKey");
      objects.set(id(to.bucket, to.key), bytes.slice());
    },
```

- Add `failCopy` to the returned object, and update the doc comment to mention it.

In `apps/web/src/server/assets/service.ts`, change the copy call to:

```ts
  await ctx.storage.copy({ bucket: "private", key: stagingKey(ownerId, id) }, { bucket: "private", key: asset.storageKey });
```

In `apps/web/src/server/assets/uploads.test.ts`:
- Change the racing wrapper to `copy: async (from: ObjectRef, to: ObjectRef) => { await storage.copy(from, to); … }`.
- Add `import type { ObjectRef } from "../storage/types";`.

Run: `corepack pnpm --filter @vash/web exec vitest run src/server/storage src/server/assets`. Expected: all pass.

- [ ] **Step 4: All-or-nothing copies**

Create `apps/web/src/server/storage/copies.ts`:

```ts
import { storageDeletions } from "../db/schema";
import type { Db } from "../db/types";
import { HttpError } from "../http/problem";
import type { ObjectRef, ObjectStorage } from "./types";

export interface Copy {
  from: ObjectRef;
  to: ObjectRef;
}

/** Queues objects for the cleanup cron, e.g. copies whose database rows never got written. */
export async function queueObjects(db: Db, refs: readonly ObjectRef[], now: Date): Promise<void> {
  if (refs.length === 0) return;
  await db.insert(storageDeletions).values(refs.map((r) => ({ bucket: r.bucket, storageKey: r.key, createdAt: now, notBefore: now })));
}

/**
 * Copies every object or none: on a failure, every copy attempted so far (the failing one may still
 * have landed) is queued for deletion and the caller gets 503.
 */
export async function copyAll(db: Db, storage: ObjectStorage, copies: readonly Copy[], now: Date): Promise<void> {
  const attempted: ObjectRef[] = [];
  try {
    for (const c of copies) {
      attempted.push(c.to);
      await storage.copy(c.from, c.to);
    }
  } catch {
    await queueObjects(db, attempted, now);
    throw new HttpError(503, "Service Unavailable", "Photo storage is unavailable. Try again in a moment.");
  }
}
```

- [ ] **Step 5: Quota and account deletion**

In `apps/web/src/server/assets/repository.ts`:
- Import `templates` from `../db/schema`.
- In `storageUsedBytes`, add a third sum before the return. Its doc comment should also mention "and the public copies of every template the owner published".

```ts
  const [published] = await db
    .select({ used: sql<string>`coalesce(sum(${assets.bytes}), 0)` })
    .from(assets)
    .innerJoin(templates, eq(templates.id, assets.templateId))
    .where(eq(templates.authorId, ownerId));
  return Number(row?.used ?? 0) + Number(queued?.used ?? 0) + Number(published?.used ?? 0);
```

In `apps/web/src/server/me/service.ts`, inside `deleteAccount`, replace the `owned` query's `where` with:

```ts
      .where(or(eq(assets.ownerId, userId), inArray(assets.templateId, tx.select({ id: templates.id }).from(templates).where(eq(templates.authorId, userId)))));
```

Then add `inArray, or` to its `drizzle-orm` import. `templates` is already imported. The templates cascade when the user row goes, and their asset rows cascade with them. This query only makes sure their objects are queued first.

- [ ] **Step 6: Write the failing publish tests**

Create `apps/web/src/server/templates/publish.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../../tests/support/db";
import { testDeps } from "../../../tests/support/deps";
import { templateDoc } from "../../../tests/support/docs";
import { createAsset, createDesign, createUser } from "../../../tests/support/factories";
import { call } from "../../../tests/support/invoke";
import { memoryStorage } from "../../../tests/support/storage";
import { assetHandlers } from "../assets/handlers";
import { storageUsedBytes } from "../assets/repository";
import { UPLOAD_LIMITS } from "../assets/service";
import { assets, designs, storageDeletions, templates, templateVersions } from "../db/schema";
import { meHandlers } from "../me/handlers";
import { templateHandlers } from "./handlers";

let t: TestDb;
let storage: ReturnType<typeof memoryStorage>;
let h: ReturnType<typeof templateHandlers>;
beforeAll(async () => {
  t = await createTestDb();
  storage = memoryStorage();
  h = templateHandlers(testDeps(t.db), storage);
});
afterAll(() => t.close());

const author = () => createUser(t.db, { handle: `u_${randomUUID().slice(0, 8)}` });
async function stored(ownerId: string, kind: "photo" | "thumbnail" = "photo") {
  const asset = await createAsset(t.db, { ownerId, kind, mime: kind === "photo" ? "image/jpeg" : "image/png" });
  storage.put("private", asset.storageKey, new Uint8Array(asset.bytes));
  return asset;
}
const publish = (as: { id: string } | null, body: Record<string, unknown>, handlers = h) =>
  call(handlers.publish, { method: "POST", as, body: { title: "Party", category: "birthday", tags: ["Fun", "fun"], ...body } });
const versionOf = async (templateId: string, version = 1) =>
  (await t.db.select().from(templateVersions).where(eq(templateVersions.templateId, templateId))).find((v) => v.version === version)!;

describe("POST /api/templates", () => {
  it("publishes a draft with unkept photos scrubbed and a public, system-owned copy of the thumbnail", async () => {
    const alice = await author();
    const photo = await stored(alice.id);
    const thumb = await stored(alice.id, "thumbnail");
    const draft = await createDesign(t.db, alice.id, templateDoc({ photoAssetId: photo.id, heading: "Mail riya@example.com" }));
    const res = await publish(alice, { designId: draft.id, thumbnailAssetId: thumb.id });
    expect(res.status).toBe(201);
    const tpl = res.body.template;
    expect(tpl).toMatchObject({ title: "Party", tags: ["fun"], status: "published", currentVersion: 1, author: { handle: alice.handle } });
    expect(res.body.warnings.pii).toHaveLength(1);
    const version = await versionOf(tpl.id);
    expect(version.doc).toMatchObject({ id: tpl.id, kind: "template", assets: {} });
    expect(version.doc.nodes.photo1).toMatchObject({ content: null, placeholder: true });
    const [copy] = await t.db.select().from(assets).where(eq(assets.id, version.thumbnailAssetId!));
    expect(copy).toMatchObject({ ownerId: null, visibility: "public", status: "ready", kind: "thumbnail", templateId: tpl.id, storageKey: `t/${tpl.id}/${copy!.id}` });
    expect(storage.has("public", copy!.storageKey)).toBe(true);
    expect((await call(h.list, { path: "/api/templates?sort=new" })).body.items.map((i: { id: string }) => i.id)).toContain(tpl.id);
  });

  it("keeps an owned photo only with the ownership confirmation, as a copy that outlives the original", async () => {
    const alice = await author();
    const photo = await stored(alice.id);
    const thumb = await stored(alice.id, "thumbnail");
    const draft = await createDesign(t.db, alice.id, templateDoc({ photoAssetId: photo.id }));
    expect((await publish(alice, { designId: draft.id, thumbnailAssetId: thumb.id, keep: [photo.id] })).status).toBe(422);
    const res = await publish(alice, { designId: draft.id, thumbnailAssetId: thumb.id, keep: [photo.id], ownsKeptPhotos: true });
    expect(res.status).toBe(201);
    const doc = (await versionOf(res.body.template.id)).doc;
    const copyId = (doc.nodes.photo1 as { content: { assetId: string } }).content.assetId;
    expect(copyId).not.toBe(photo.id);
    expect(Object.keys(doc.assets)).toEqual([copyId]);
    const [copy] = await t.db.select().from(assets).where(eq(assets.id, copyId));
    expect(copy).toMatchObject({ ownerId: null, visibility: "public", templateId: res.body.template.id, bytes: photo.bytes });

    const assetApi = assetHandlers(testDeps(t.db), storage);
    expect((await call(assetApi.remove, { method: "DELETE", as: alice, params: { id: photo.id } })).status).toBe(204);
    const resolved = await call(assetApi.resolve, { method: "POST", body: { ids: [copyId] } });
    expect(resolved.body.assets).toEqual([{ id: copyId, url: `https://cdn.test/${copy!.storageKey}`, expiresAt: null }]);
  });

  it("refuses authors without a handle, drafts with problems, and thumbnails that aren't theirs", async () => {
    const alice = await author();
    const bob = await author();
    const noHandle = await createUser(t.db);
    const thumb = await stored(alice.id, "thumbnail");
    const photo = await stored(alice.id);
    const draft = await createDesign(t.db, alice.id, templateDoc());
    const broken = templateDoc();
    broken.nodes.heading!.lock = "locked";
    Object.assign(broken.nodes.photo1!, { placeholder: false });
    const brokenDraft = await createDesign(t.db, alice.id, broken);
    const theirDraft = await createDesign(t.db, noHandle.id, templateDoc());
    const theirThumb = await stored(noHandle.id, "thumbnail");

    expect((await publish(noHandle, { designId: theirDraft.id, thumbnailAssetId: theirThumb.id })).body.detail).toMatch(/handle/);
    const lint = await publish(alice, { designId: brokenDraft.id, thumbnailAssetId: thumb.id });
    expect(lint.status).toBe(422);
    expect(lint.body.issues.length).toBeGreaterThan(0);
    expect((await publish(alice, { designId: draft.id, thumbnailAssetId: photo.id })).status).toBe(422);
    expect((await publish(bob, { designId: draft.id, thumbnailAssetId: thumb.id })).status).toBe(404);
    expect((await publish(null, { designId: draft.id, thumbnailAssetId: thumb.id })).status).toBe(401);
    expect((await publish(alice, { designId: draft.id, thumbnailAssetId: thumb.id, category: "weddings" })).status).toBe(400);
  });

  it("counts published copies toward the author's quota, and refuses to go over it", async () => {
    const alice = await author();
    const thumb = await stored(alice.id, "thumbnail");
    const draft = await createDesign(t.db, alice.id, templateDoc());
    const before = await storageUsedBytes(t.db, alice.id);
    expect((await publish(alice, { designId: draft.id, thumbnailAssetId: thumb.id })).status).toBe(201);
    expect(await storageUsedBytes(t.db, alice.id)).toBe(before + thumb.bytes);

    const bob = await author();
    await createAsset(t.db, { ownerId: bob.id, bytes: UPLOAD_LIMITS.storageQuotaBytes - 1500 });
    const bobThumb = await stored(bob.id, "thumbnail");
    const bobDraft = await createDesign(t.db, bob.id, templateDoc());
    const publicObjects = () => [...storage.objects.keys()].filter((k) => k.startsWith("public:")).length;
    const publicBefore = publicObjects();
    expect((await publish(bob, { designId: bobDraft.id, thumbnailAssetId: bobThumb.id })).status).toBe(422);
    expect(await t.db.select().from(templates).where(eq(templates.authorId, bob.id))).toEqual([]);
    expect(publicObjects()).toBe(publicBefore);
  });

  it("leaves no half-published template when storage fails, and queues what it copied", async () => {
    const alice = await author();
    const photo = await stored(alice.id);
    const thumb = await stored(alice.id, "thumbnail");
    const draft = await createDesign(t.db, alice.id, templateDoc({ photoAssetId: photo.id }));
    const queuedBefore = new Set((await t.db.select().from(storageDeletions)).map((r) => r.id));
    storage.failCopy.add(thumb.storageKey);
    const res = await publish(alice, { designId: draft.id, thumbnailAssetId: thumb.id, keep: [photo.id], ownsKeptPhotos: true });
    storage.failCopy.delete(thumb.storageKey);
    expect(res.status).toBe(503);
    expect(await t.db.select().from(templates).where(eq(templates.authorId, alice.id))).toEqual([]);
    const queued = (await t.db.select().from(storageDeletions)).filter((r) => !queuedBefore.has(r.id));
    expect(queued).toHaveLength(2);
    expect(queued.every((r) => r.bucket === "public" && r.storageKey.startsWith("t/"))).toBe(true);
  });

  it("allows 5 publishes a day", async () => {
    const alice = await author();
    const thumb = await stored(alice.id, "thumbnail");
    const draft = await createDesign(t.db, alice.id, templateDoc());
    const fixed = templateHandlers(testDeps(t.db, { now: () => new Date("2026-09-26T10:00:00Z") }), storage);
    for (let i = 0; i < 5; i++) expect((await publish(alice, { designId: draft.id, thumbnailAssetId: thumb.id }, fixed)).status).toBe(201);
    expect((await publish(alice, { designId: draft.id, thumbnailAssetId: thumb.id }, fixed)).status).toBe(429);
  });

  it("removes an author's templates with their account and queues the published copies", async () => {
    const alice = await author();
    const thumb = await stored(alice.id, "thumbnail");
    const draft = await createDesign(t.db, alice.id, templateDoc());
    const { body } = await publish(alice, { designId: draft.id, thumbnailAssetId: thumb.id });
    const copyKey = `t/${body.template.id}/${(await versionOf(body.template.id)).thumbnailAssetId}`;
    expect((await call(meHandlers(testDeps(t.db)).remove, { method: "DELETE", as: alice, body: { confirm: alice.email } })).status).toBe(204);
    expect(await t.db.select().from(templates).where(eq(templates.id, body.template.id))).toEqual([]);
    expect(await t.db.select().from(assets).where(eq(assets.templateId, body.template.id))).toEqual([]);
    expect((await t.db.select().from(storageDeletions).where(eq(storageDeletions.storageKey, copyKey))).map((r) => r.bucket)).toEqual(["public"]);
  });
});

describe("POST /api/templates/:id/versions", () => {
  it("publishes a new version for the author only, leaving earlier versions and designs alone", async () => {
    const alice = await author();
    const bob = await author();
    const thumb = await stored(alice.id, "thumbnail");
    const draft = await createDesign(t.db, alice.id, templateDoc());
    const { body } = await publish(alice, { designId: draft.id, thumbnailAssetId: thumb.id });
    const id = body.template.id;
    const used = await call(h.use, { method: "POST", as: bob, params: { id } });
    await t.db.update(templates).set({ status: "hidden" }).where(eq(templates.id, id));

    const next = await call(h.publishVersion, { method: "POST", as: alice, params: { id }, body: { designId: draft.id, thumbnailAssetId: thumb.id, title: "Party v2", category: "events" } });
    expect(next.status).toBe(201);
    expect(next.body.template).toMatchObject({ title: "Party v2", category: "events", currentVersion: 2, status: "hidden" });
    expect((await versionOf(id, 1)).doc.meta.title).toBe("Party");
    const [design] = await t.db.select().from(designs).where(eq(designs.id, used.body.id));
    expect(design?.sourceTemplateVersion).toBe(1);

    const bobsDraft = await createDesign(t.db, bob.id, templateDoc());
    const bobsThumb = await stored(bob.id, "thumbnail");
    expect((await call(h.publishVersion, { method: "POST", as: bob, params: { id }, body: { designId: bobsDraft.id, thumbnailAssetId: bobsThumb.id, title: "Mine", category: "events" } })).status).toBe(404);
  });
});
```

Run: `corepack pnpm --filter @vash/web exec vitest run src/server/templates/publish.test.ts`. Expected: FAIL, because `h.publish` is undefined.

- [ ] **Step 7: Implement publishing**

Create `apps/web/src/server/templates/publish.ts`:

```ts
import { randomUUID } from "node:crypto";
import { parseDoc, replaceAssetIds, type PiiFinding } from "@vash/schema";
import { and, eq, sql } from "drizzle-orm";
import { getOwnedAsset, storageUsedBytes } from "../assets/repository";
import { UPLOAD_LIMITS } from "../assets/service";
import { assets, templates, user } from "../db/schema";
import type { Db } from "../db/types";
import type { CurrentUser } from "../deps";
import { conflict, notFound, unprocessable } from "../http/problem";
import { copyAll, queueObjects, type Copy } from "../storage/copies";
import type { ObjectStorage } from "../storage/types";
import { analyzeDraft } from "./draft";
import { getTemplateCard, insertTemplate, insertTemplateVersion, searchTextFor, type TemplateCard } from "./repository";

export interface PublishInput {
  designId: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
  keep: string[];
  ownsKeptPhotos: boolean;
  thumbnailAssetId: string;
}

export interface PublishContext {
  db: Db;
  now: () => Date;
  storage: ObjectStorage;
}

const overQuota = (used: number) =>
  unprocessable("Publishing these photos would go over your 500 MB of storage. Delete some photos to make room.", {
    limitBytes: UPLOAD_LIMITS.storageQuotaBytes,
    usedBytes: used,
  });

/**
 * Spec §8.4. Publishes a template draft as a new template (`templateId` null) or as the next version
 * of the author's template. Kept photos and the thumbnail become system-owned public copies, so the
 * author deleting an original never breaks the template; their bytes still count toward the author's quota.
 */
export async function publishTemplate(
  ctx: PublishContext,
  author: CurrentUser,
  input: PublishInput,
  templateId: string | null,
): Promise<{ template: TemplateCard; pii: PiiFinding[] }> {
  if (!author.handle) throw unprocessable("Choose a handle in Settings before publishing.");
  const existing = templateId ? await getTemplateCard(ctx.db, templateId) : undefined;
  if (templateId && existing?.authorId !== author.id) throw notFound();

  const draft = await analyzeDraft(ctx.db, author.id, input.designId, input.keep);
  if (draft.issues.length > 0) throw unprocessable("Fix the template's problems before publishing.", { issues: draft.issues });
  if (draft.kept.length > 0 && !input.ownsKeptPhotos) throw unprocessable("Confirm that you own the photos you keep and allow others to reuse them.");
  const thumbnail = await getOwnedAsset(ctx.db, author.id, input.thumbnailAssetId);
  if (thumbnail?.status !== "ready" || thumbnail.kind !== "thumbnail") throw unprocessable("thumbnailAssetId must be one of your uploaded thumbnails.");

  const id = templateId ?? randomUUID();
  const now = ctx.now();
  const copies = [...draft.kept, thumbnail].map((source) => ({ source, id: randomUUID() }));
  const keyOf = (assetId: string) => `t/${id}/${assetId}`;
  const bytes = copies.reduce((n, c) => n + c.source.bytes, 0);
  const used = await storageUsedBytes(ctx.db, author.id);
  if (used + bytes > UPLOAD_LIMITS.storageQuotaBytes) throw overQuota(used);

  const renamed = replaceAssetIds(draft.doc, new Map(copies.slice(0, -1).map((c) => [c.source.id, c.id])));
  const parsed = parseDoc(
    { ...renamed, id, kind: "template", meta: { title: input.title, category: input.category, tags: input.tags, format: renamed.meta.format } },
    { kind: "template" },
  );
  if (!parsed.ok) throw unprocessable("Fix the template's problems before publishing.", { issues: parsed.issues.slice(0, 50) });
  const doc = parsed.doc;

  const objects: Copy[] = copies.map((c) => ({ from: { bucket: "private", key: c.source.storageKey }, to: { bucket: "public", key: keyOf(c.id) } }));
  await copyAll(ctx.db, ctx.storage, objects, now);
  try {
    await ctx.db.transaction(async (tx) => {
      // Same lock as uploads and account deletion: the quota check and these inserts can't interleave with either.
      const [me] = await tx.select({ id: user.id }).from(user).where(eq(user.id, author.id)).for("no key update");
      if (!me) throw notFound();
      const usedNow = await storageUsedBytes(tx, author.id);
      if (usedNow + bytes > UPLOAD_LIMITS.storageQuotaBytes) throw overQuota(usedNow);
      const fields = {
        title: doc.meta.title,
        description: input.description,
        category: input.category,
        tags: input.tags,
        format: doc.meta.format,
        width: doc.artboard.width,
        height: doc.artboard.height,
        searchText: searchTextFor(doc.meta.title, input.tags),
        updatedAt: now,
      };
      let version = 1;
      if (existing) {
        const [bumped] = await tx
          .update(templates)
          .set({ ...fields, currentVersion: sql`${templates.currentVersion} + 1` })
          .where(and(eq(templates.id, id), eq(templates.authorId, author.id), eq(templates.currentVersion, existing.currentVersion)))
          .returning({ version: templates.currentVersion });
        if (!bumped) throw conflict("This template was republished at the same time. Reload it and try again.");
        version = bumped.version;
      } else {
        await insertTemplate(tx, { id, authorId: author.id, ...fields, createdAt: now });
      }
      await tx.insert(assets).values(
        copies.map((c) => ({
          id: c.id,
          ownerId: null,
          templateId: id,
          kind: c.source.kind,
          visibility: "public" as const,
          status: "ready" as const,
          storageKey: keyOf(c.id),
          mime: c.source.mime,
          bytes: c.source.bytes,
          width: c.source.width,
          height: c.source.height,
          createdAt: now,
          updatedAt: now,
        })),
      );
      await insertTemplateVersion(tx, { templateId: id, version, doc, thumbnailAssetId: copies.at(-1)!.id, createdAt: now });
    });
  } catch (err) {
    await queueObjects(ctx.db, objects.map((o) => o.to), now);
    throw err;
  }
  return { template: (await getTemplateCard(ctx.db, id))!, pii: draft.pii };
}
```

(`copies.slice(0, -1)` holds the kept photos: the thumbnail is always last and isn't referenced by the document.)

In `apps/web/src/server/templates/handlers.ts`:
- Change the signature to `export function templateHandlers(deps: Deps, storage: ObjectStorage | null = null)`.
- Add imports: `LIMITS` (to the `@vash/schema` import), `HttpError` (to the `../http/problem` import), `import type { ObjectStorage } from "../storage/types";`, and `import { publishTemplate, type PublishContext } from "./publish";`.
- Add:

```ts
const publishLimit = { name: "publish", rule: RATE_LIMITS.publish, by: "user" } as const;
const PublishBody = z
  .object({
    designId: Uuid,
    title: z.string().trim().min(1).max(LIMITS.titleChars),
    description: z.string().trim().max(PUBLISH_LIMITS.descriptionChars).default(""),
    category: z.string().refine((c) => CATEGORIES.includes(c), "Unknown category."),
    tags: z
      .array(z.string().trim().toLowerCase().min(1).max(LIMITS.tagChars))
      .max(LIMITS.tags)
      .default([])
      .transform((tags) => [...new Set(tags)]),
    keep: z.array(Uuid).max(PUBLISH_LIMITS.keptPhotos).default([]),
    ownsKeptPhotos: z.boolean().default(false),
    thumbnailAssetId: Uuid,
  })
  .strict();
```

Inside `templateHandlers`, before `return`:

```ts
  const publishing = (): PublishContext => {
    if (!storage) throw new HttpError(503, "Service Unavailable", "Photo storage isn't configured on this server.");
    return { db: deps.db, now: deps.now, storage };
  };
```

and the two endpoints:

```ts
    publish: endpoint(deps, { auth: "user", rateLimit: publishLimit }, async ({ req, user }) => {
      const ctx = publishing();
      const r = await publishTemplate(ctx, user, await readJson(req, PublishBody), null);
      return Response.json({ template: toTemplateJson(r.template), warnings: { pii: r.pii } }, { status: 201 });
    }),

    publishVersion: endpoint(deps, { auth: "user", rateLimit: publishLimit }, async ({ req, user, params }) => {
      const ctx = publishing();
      const id = parseId(params.id);
      const r = await publishTemplate(ctx, user, await readJson(req, PublishBody), id);
      return Response.json({ template: toTemplateJson(r.template), warnings: { pii: r.pii } }, { status: 201 });
    }),
```

In `apps/web/src/app/api/templates/route.ts`, add `export const POST = route((app) => app.templates.publish);`.

Create `apps/web/src/app/api/templates/[id]/versions/route.ts`:

```ts
import { route } from "@/server/context";

export const POST = route((app) => app.templates.publishVersion);
```

In `apps/web/src/server/context.ts`, change the wiring to `templates: templateHandlers(deps, storage),`.

- [ ] **Step 8: Run the tests**

Run: `corepack pnpm -r test && corepack pnpm -r typecheck`
Expected: all pass, including the account-deletion and upload suites.

- [ ] **Step 9: Record the decision**

Append to `docs/decisions.md`:

```
| 34 | 2026-09-26 | **Published photos are system-owned public copies** at `t/{templateId}/{assetId}`, linked by `assets.template_id`; the thumbnail too. They count toward the author's 500 MB. Deleting the account deletes the author's templates and queues their copies (others' designs made from them then show the missing-photo state). Multi-object copies are all-or-nothing (`copyAll`): after a failure every attempted copy is queued and the caller gets 503. | Satisfies row 29 (an author deleting an original never breaks a template) without letting publishing bypass the quota; account deletion stays complete. |
```

- [ ] **Step 10: Commit**

```bash
git add packages/schema apps/web/src apps/web/tests docs/decisions.md
git commit -m "feat(web): publish templates and new versions with public system-owned photo copies"
```

---

### Task 6: Share links and the shared view

**Files:**
- Create:
  - `apps/web/src/server/shares/repository.ts`, `apps/web/src/server/shares/service.ts`, `apps/web/src/server/shares/handlers.ts`, `apps/web/src/server/shares/shares.test.ts`
  - `apps/web/src/app/api/designs/[id]/share/route.ts`, `apps/web/src/app/api/designs/[id]/share/[linkId]/route.ts`
  - `apps/web/src/app/api/shared/[token]/route.ts`
- Modify: `apps/web/src/server/context.ts`, `docs/decisions.md`

**Interfaces:**
- Consumes: `getDesignVersion`, `resolveAssets`, `referencedAssetIds`.
- Produces:
  - `SHARE_TOKEN`, `newShareToken()`, `hashToken(token)`.
  - `openShare(db, token): Promise<{ link, design, ownerName, ownerHandle }>`: 404 when unknown, 410 when revoked.
  - `shareHandlers(deps, storage)` with `create`, `list`, `revoke` and `view`.
  - `app.shares`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/server/shares/shares.test.ts`:

```ts
import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../../tests/support/db";
import { testDeps } from "../../../tests/support/deps";
import { docWithPhoto, emptyDoc } from "../../../tests/support/docs";
import { createAsset, createDesign, createUser } from "../../../tests/support/factories";
import { call } from "../../../tests/support/invoke";
import { captureLogger } from "../../../tests/support/logger";
import { memoryStorage } from "../../../tests/support/storage";
import { testConfig } from "../../../tests/support/config";
import { designs, shareLinks } from "../db/schema";
import { shareHandlers } from "./handlers";

let t: TestDb;
let h: ReturnType<typeof shareHandlers>;
beforeAll(async () => {
  t = await createTestDb();
  h = shareHandlers(testDeps(t.db), memoryStorage());
});
afterAll(() => t.close());

const share = (as: { id: string } | null, designId: string) => call(h.create, { method: "POST", as, params: { id: designId } });
const view = (token: string, handlers = h) => call(handlers.view, { path: `/api/shared/${token}`, params: { token } });

describe("share links", () => {
  it("creates a link whose token is shown once and stored only as a hash", async () => {
    const alice = await createUser(t.db);
    const design = await createDesign(t.db, alice.id, emptyDoc());
    const res = await share(alice, design.id);
    expect(res.status).toBe(201);
    expect(res.body.token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(res.body.url).toBe(`${testConfig.appOrigin}/s/${res.body.token}`);
    const [row] = await t.db.select().from(shareLinks).where(eq(shareLinks.id, res.body.id));
    expect(row!.tokenHash).toBe(createHash("sha256").update(res.body.token).digest("hex"));
    expect(JSON.stringify(row)).not.toContain(res.body.token);
    const listed = await call(h.list, { as: alice, params: { id: design.id } });
    expect(listed.body).toEqual({ items: [{ id: res.body.id, createdAt: res.body.createdAt }] });
  });

  it("lets only the owner create, list or revoke links", async () => {
    const alice = await createUser(t.db);
    const bob = await createUser(t.db);
    const design = await createDesign(t.db, alice.id, emptyDoc());
    const { body } = await share(alice, design.id);
    expect((await share(bob, design.id)).status).toBe(404);
    expect((await share(null, design.id)).status).toBe(401);
    expect((await call(h.list, { as: bob, params: { id: design.id } })).status).toBe(404);
    expect((await call(h.revoke, { method: "DELETE", as: bob, params: { id: design.id, linkId: body.id } })).status).toBe(404);
    expect((await view(body.token)).status).toBe(200);
  });

  it("opens the design read-only, with signed URLs for its own photos only and no account details", async () => {
    const alice = await createUser(t.db, { name: "Alice", handle: `u_${randomUUID().slice(0, 8)}` });
    const inDoc = await createAsset(t.db, { ownerId: alice.id });
    const notInDoc = await createAsset(t.db, { ownerId: alice.id });
    const design = await createDesign(t.db, alice.id, docWithPhoto(inDoc.id));
    const { body } = await share(alice, design.id);
    const res = await view(body.token);
    expect(res.status).toBe(200);
    expect(res.body.design).toMatchObject({ title: design.title, format: "ig-post", width: 1080, height: 1080 });
    expect(res.body.design.doc.nodes.photo1.content.assetId).toBe(inDoc.id);
    expect(res.body.owner).toEqual({ name: "Alice", handle: alice.handle });
    expect(res.body.assets.map((a: { id: string }) => a.id)).toEqual([inDoc.id]);
    expect(res.body.assets[0].url).toContain("op=get");
    const text = JSON.stringify(res.body);
    // Signed URLs carry the storage key (u/{ownerId}/…), so only the email and unrelated assets are checked.
    for (const secret of [alice.email, notInDoc.id]) expect(text).not.toContain(secret);
  });

  it("answers 410 once revoked, and 404 for unknown, malformed or deleted ones", async () => {
    const alice = await createUser(t.db);
    const design = await createDesign(t.db, alice.id, emptyDoc());
    const { body } = await share(alice, design.id);
    const revoke = () => call(h.revoke, { method: "DELETE", as: alice, params: { id: design.id, linkId: body.id } });
    expect((await revoke()).status).toBe(204);
    expect((await revoke()).status).toBe(204);
    const gone = await view(body.token);
    expect(gone.status).toBe(410);
    expect(gone.body.detail).toMatch(/turned off/);
    expect((await call(h.list, { as: alice, params: { id: design.id } })).body.items).toEqual([]);
    expect((await view("A".repeat(22))).status).toBe(404);
    expect((await view("short")).status).toBe(404);

    const other = await createDesign(t.db, alice.id, emptyDoc());
    const live = (await share(alice, other.id)).body;
    await t.db.delete(designs).where(eq(designs.id, other.id));
    expect((await view(live.token)).status).toBe(404);
  });

  it("never writes the token to the logs", async () => {
    const alice = await createUser(t.db);
    const design = await createDesign(t.db, alice.id, emptyDoc());
    const { body } = await share(alice, design.id);
    const logger = captureLogger();
    const logged = shareHandlers(testDeps(t.db, { logger }), memoryStorage());
    await view(body.token, logged);
    await view("B".repeat(22), logged);
    expect(logger.entries.length).toBeGreaterThan(0);
    expect(JSON.stringify(logger.entries)).not.toContain(body.token);
  });

  it("still shows the design when storage isn't configured", async () => {
    const alice = await createUser(t.db);
    const photo = await createAsset(t.db, { ownerId: alice.id });
    const design = await createDesign(t.db, alice.id, docWithPhoto(photo.id));
    const { body } = await share(alice, design.id);
    const res = await view(body.token, shareHandlers(testDeps(t.db), null));
    expect(res.status).toBe(200);
    expect(res.body.assets).toEqual([]);
  });
});
```

Run: `corepack pnpm --filter @vash/web exec vitest run src/server/shares`. Expected: FAIL, because `./handlers` doesn't exist.

- [ ] **Step 2: Implement**

Create `apps/web/src/server/shares/repository.ts`:

```ts
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { designs, shareLinks, user } from "../db/schema";
import type { Db } from "../db/types";
import type { DesignRow } from "../designs/repository";

/** 128 random bits, base64url-encoded: always 22 characters. */
export const SHARE_TOKEN = /^[A-Za-z0-9_-]{22}$/;
export const newShareToken = () => randomBytes(16).toString("base64url");
/** Only this hash is stored, so a database leak doesn't hand out working links. */
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export type ShareLinkRow = typeof shareLinks.$inferSelect;

export async function insertShareLink(db: Db, v: { designId: string; createdBy: string; tokenHash: string; now: Date }): Promise<ShareLinkRow> {
  const [row] = await db.insert(shareLinks).values({ designId: v.designId, createdBy: v.createdBy, tokenHash: v.tokenHash, createdAt: v.now }).returning();
  return row!;
}

/** Newest first; the caller has already checked that the design is theirs. */
export function listActiveShareLinks(db: Db, designId: string): Promise<ShareLinkRow[]> {
  return db
    .select()
    .from(shareLinks)
    .where(and(eq(shareLinks.designId, designId), isNull(shareLinks.revokedAt)))
    .orderBy(desc(shareLinks.createdAt), desc(shareLinks.id))
    .limit(100);
}

/** Idempotent. False when the link doesn't exist or the design isn't the owner's. */
export async function revokeShareLink(db: Db, ownerId: string, designId: string, linkId: string, now: Date): Promise<boolean> {
  const rows = await db
    .update(shareLinks)
    .set({ revokedAt: sql`coalesce(${shareLinks.revokedAt}, ${now.toISOString()}::timestamptz)` })
    .where(
      and(
        eq(shareLinks.id, linkId),
        eq(shareLinks.designId, designId),
        sql`exists (select 1 from ${designs} where ${designs.id} = ${shareLinks.designId} and ${designs.ownerId} = ${ownerId})`,
      ),
    )
    .returning({ id: shareLinks.id });
  return rows.length > 0;
}

export async function findShareByTokenHash(
  db: Db,
  tokenHash: string,
): Promise<{ link: ShareLinkRow; design: DesignRow; ownerName: string; ownerHandle: string | null } | undefined> {
  const [row] = await db
    .select({ link: shareLinks, design: designs, ownerName: user.name, ownerHandle: user.handle })
    .from(shareLinks)
    .innerJoin(designs, eq(designs.id, shareLinks.designId))
    .innerJoin(user, eq(user.id, designs.ownerId))
    .where(eq(shareLinks.tokenHash, tokenHash));
  return row;
}
```

Create `apps/web/src/server/shares/service.ts`:

```ts
import { referencedAssetIds } from "@vash/schema";
import { resolveAssets } from "../assets/service";
import type { Db } from "../db/types";
import { getDesignVersion } from "../designs/repository";
import { isUuid } from "../http/ids";
import { HttpError, notFound } from "../http/problem";
import type { ObjectStorage } from "../storage/types";
import { findShareByTokenHash, hashToken, insertShareLink, newShareToken, SHARE_TOKEN } from "./repository";

export async function createShare(ctx: { db: Db; now: () => Date }, ownerId: string, designId: string) {
  if ((await getDesignVersion(ctx.db, ownerId, designId)) === undefined) throw notFound();
  const token = newShareToken();
  const link = await insertShareLink(ctx.db, { designId, createdBy: ownerId, tokenHash: hashToken(token), now: ctx.now() });
  return { link, token };
}

/** 404 for a token that never existed; 410 for a revoked one, so the page can say so. */
export async function openShare(db: Db, token: string) {
  if (!SHARE_TOKEN.test(token)) throw notFound();
  const found = await findShareByTokenHash(db, hashToken(token));
  if (!found) throw notFound();
  if (found.link.revokedAt) throw new HttpError(410, "Gone", "This link has been turned off by its owner.");
  return found;
}

/** Read-only view. The token grants what the owner could see of this design's own photos, nothing else. */
export async function viewShare(ctx: { db: Db; now: () => Date; storage: ObjectStorage | null }, token: string) {
  const { design, ownerName, ownerHandle } = await openShare(ctx.db, token);
  const ids = [...referencedAssetIds(design.doc)].filter(isUuid);
  const assets = ctx.storage && ids.length > 0 ? await resolveAssets({ db: ctx.db, now: ctx.now, storage: ctx.storage }, design.ownerId, ids) : [];
  return {
    design: {
      title: design.title,
      format: design.doc.meta.format,
      width: design.doc.artboard.width,
      height: design.doc.artboard.height,
      doc: design.doc,
      updatedAt: design.updatedAt.toISOString(),
    },
    owner: { name: ownerName, handle: ownerHandle },
    assets,
  };
}
```


Create `apps/web/src/server/shares/handlers.ts`:

```ts
import type { Deps } from "../deps";
import { getDesignVersion } from "../designs/repository";
import { endpoint } from "../http/endpoint";
import { parseId } from "../http/ids";
import { notFound } from "../http/problem";
import { RATE_LIMITS } from "../rate-limit/rules";
import type { ObjectStorage } from "../storage/types";
import { listActiveShareLinks, revokeShareLink } from "./repository";
import { createShare, viewShare } from "./service";

const writeLimit = { name: "userWrite", rule: RATE_LIMITS.userWrite, by: "user" } as const;

export function shareHandlers(deps: Deps, storage: ObjectStorage | null) {
  const ctx = { db: deps.db, now: deps.now };
  return {
    create: endpoint(deps, { auth: "user", rateLimit: { name: "shareCreate", rule: RATE_LIMITS.shareCreate, by: "user" } }, async ({ user, params }) => {
      const { link, token } = await createShare(ctx, user.id, parseId(params.id));
      return Response.json({ id: link.id, token, url: `${deps.config.appOrigin}/s/${token}`, createdAt: link.createdAt.toISOString() }, { status: 201 });
    }),

    list: endpoint(deps, { auth: "user" }, async ({ user, params }) => {
      const designId = parseId(params.id);
      if ((await getDesignVersion(deps.db, user.id, designId)) === undefined) throw notFound();
      const links = await listActiveShareLinks(deps.db, designId);
      return Response.json({ items: links.map((l) => ({ id: l.id, createdAt: l.createdAt.toISOString() })) });
    }),

    revoke: endpoint(deps, { auth: "user", rateLimit: writeLimit }, async ({ user, params }) => {
      if (!(await revokeShareLink(deps.db, user.id, parseId(params.id), parseId(params.linkId), deps.now()))) throw notFound();
      return new Response(null, { status: 204 });
    }),

    view: endpoint(deps, { auth: "none", rateLimit: { name: "sharedView", rule: RATE_LIMITS.sharedView, by: "ip" } }, async ({ params }) => {
      return Response.json(await viewShare({ ...ctx, storage }, params.token ?? ""));
    }),
  };
}
```

Create the routes:
- `apps/web/src/app/api/designs/[id]/share/route.ts`: `GET` = `app.shares.list`, `POST` = `app.shares.create`.
- `apps/web/src/app/api/designs/[id]/share/[linkId]/route.ts`: `DELETE` = `app.shares.revoke`.
- `apps/web/src/app/api/shared/[token]/route.ts`: `GET` = `app.shares.view`.

Each follows the one-line `route((app) => …)` pattern with `import { route } from "@/server/context";`.

In `apps/web/src/server/context.ts`, add `import { shareHandlers } from "./shares/handlers";` and `shares: shareHandlers(deps, storage),`.

- [ ] **Step 3: Run the tests**

Run: `corepack pnpm --filter @vash/web exec vitest run src/server/shares && corepack pnpm --filter @vash/web typecheck`
Expected: all pass.

- [ ] **Step 4: Record the decision**

Append to `docs/decisions.md`:

```
| 35 | 2026-09-26 | **Share links:** `GET /api/designs/:id/share` (not in §9.3) lists a design's active links by id and date, never tokens, so the owner can find and revoke them. A revoked link answers **410** (the Shared View says "turned off by its owner"); an unknown one 404. The shared view signs only the photos the document references, as the owner would see them, and names the owner by name and handle only. | The brief's revoked state needs to be distinguishable; tokens stay write-once; no widening of what a link grants. |
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/server/shares apps/web/src/app/api/designs apps/web/src/app/api/shared apps/web/src/server/context.ts docs/decisions.md
git commit -m "feat(web): design share links (hashed, revocable) and the read-only shared view"
```

---

### Task 7: Remix a shared design

**Files:**
- Create: `apps/web/src/server/shares/remix.ts`, `apps/web/src/server/shares/remix.test.ts`, `apps/web/src/app/api/shared/[token]/remix/route.ts`
- Modify: `apps/web/src/server/shares/handlers.ts`, `docs/decisions.md`

**Interfaces:**
- Consumes: `openShare` (Task 6); `copyAll`, `queueObjects`, `replaceAssetIds` (Task 5); `insertWithinQuota`, `insertDesign`, `toDesignJson`, `assetKey`, `storageUsedBytes`, `findUnusableAssets`.
- Produces: `remixShare(ctx, remixer, token): Promise<DesignRow>`; `shareHandlers(...).remix`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/server/shares/remix.test.ts`:

```ts
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../../tests/support/db";
import { testDeps } from "../../../tests/support/deps";
import { docWithPhoto, emptyDoc } from "../../../tests/support/docs";
import { createAsset, createDesign, createUser } from "../../../tests/support/factories";
import { call } from "../../../tests/support/invoke";
import { memoryStorage } from "../../../tests/support/storage";
import { assetHandlers } from "../assets/handlers";
import { UPLOAD_LIMITS } from "../assets/service";
import { assets, designs, storageDeletions } from "../db/schema";
import { designHandlers } from "../designs/handlers";
import { shareHandlers } from "./handlers";

let t: TestDb;
let storage: ReturnType<typeof memoryStorage>;
let h: ReturnType<typeof shareHandlers>;
beforeAll(async () => {
  t = await createTestDb();
  storage = memoryStorage();
  h = shareHandlers(testDeps(t.db), storage);
});
afterAll(() => t.close());

async function sharedWithPhoto() {
  const owner = await createUser(t.db);
  const photo = await createAsset(t.db, { ownerId: owner.id });
  storage.put("private", photo.storageKey, new Uint8Array(photo.bytes));
  const design = await createDesign(t.db, owner.id, docWithPhoto(photo.id));
  const { body } = await call(h.create, { method: "POST", as: owner, params: { id: design.id } });
  return { owner, photo, design, token: body.token as string, linkId: body.id as string };
}
const remix = (as: { id: string } | null, token: string, handlers = h) => call(handlers.remix, { method: "POST", as, path: `/api/shared/${token}/remix`, params: { token } });

describe("POST /api/shared/:token/remix", () => {
  it("gives the remixer their own design with copies of the sharer's photos", async () => {
    const { owner, photo, design, token } = await sharedWithPhoto();
    const bob = await createUser(t.db);
    const res = await remix(bob, token);
    expect(res.status).toBe(201);
    expect(res.body.title).toBe(`Remix of ${design.title}`);
    const copyId = res.body.doc.nodes.photo1.content.assetId;
    expect(copyId).not.toBe(photo.id);
    const [copy] = await t.db.select().from(assets).where(eq(assets.id, copyId));
    expect(copy).toMatchObject({ ownerId: bob.id, visibility: "private", status: "ready", kind: "photo", storageKey: `u/${bob.id}/${copyId}` });
    expect(storage.has("private", copy!.storageKey)).toBe(true);

    expect((await call(assetHandlers(testDeps(t.db), storage).remove, { method: "DELETE", as: owner, params: { id: photo.id } })).status).toBe(204);
    expect(storage.has("private", copy!.storageKey)).toBe(true);
    const saved = await call(designHandlers(testDeps(t.db)).save, { method: "PUT", as: bob, params: { id: res.body.id }, body: { doc: res.body.doc, version: 1 } });
    expect(saved.status).toBe(200);
  });

  it("counts the copies toward the remixer's quota, copying nothing when it's full", async () => {
    const { token, photo } = await sharedWithPhoto();
    const bob = await createUser(t.db);
    await createAsset(t.db, { ownerId: bob.id, bytes: UPLOAD_LIMITS.storageQuotaBytes - photo.bytes + 1 });
    expect((await remix(bob, token)).status).toBe(422);
    expect(await t.db.select().from(designs).where(eq(designs.ownerId, bob.id))).toEqual([]);
    expect([...storage.objects.keys()].some((k) => k.includes(`u/${bob.id}/`))).toBe(false);
  });

  it("turns photos that no longer exist into empty placeholders", async () => {
    const { photo, token } = await sharedWithPhoto();
    await t.db.delete(assets).where(eq(assets.id, photo.id));
    const bob = await createUser(t.db);
    const res = await remix(bob, token);
    expect(res.status).toBe(201);
    expect(res.body.doc.nodes.photo1).toMatchObject({ content: null, placeholder: true });
    expect(res.body.doc.assets).toEqual({});
  });

  it("answers 401 to guests, 410 for revoked links and 404 for unknown ones", async () => {
    const { owner, design, token, linkId } = await sharedWithPhoto();
    const bob = await createUser(t.db);
    expect((await remix(null, token)).status).toBe(401);
    expect((await remix(bob, "C".repeat(22))).status).toBe(404);
    await call(h.revoke, { method: "DELETE", as: owner, params: { id: design.id, linkId } });
    expect((await remix(bob, token)).status).toBe(410);
  });

  it("answers 503 and queues what it copied when storage fails", async () => {
    const { photo, token } = await sharedWithPhoto();
    const bob = await createUser(t.db);
    storage.failCopy.add(photo.storageKey);
    const res = await remix(bob, token);
    storage.failCopy.delete(photo.storageKey);
    expect(res.status).toBe(503);
    expect(await t.db.select().from(designs).where(eq(designs.ownerId, bob.id))).toEqual([]);
    const queued = await t.db.select().from(storageDeletions);
    expect(queued.some((r) => r.storageKey.startsWith(`u/${bob.id}/`))).toBe(true);
  });

  it("remixes a design without photos even when storage isn't configured", async () => {
    const owner = await createUser(t.db);
    const design = await createDesign(t.db, owner.id, emptyDoc());
    const { body } = await call(h.create, { method: "POST", as: owner, params: { id: design.id } });
    const bob = await createUser(t.db);
    expect((await remix(bob, body.token, shareHandlers(testDeps(t.db), null))).status).toBe(201);
  });
});
```

Run: `corepack pnpm --filter @vash/web exec vitest run src/server/shares/remix.test.ts`. Expected: FAIL, because `h.remix` is undefined.

- [ ] **Step 2: Implement**

Create `apps/web/src/server/shares/remix.ts`:

```ts
import { randomUUID } from "node:crypto";
import { LIMITS, referencedAssetIds, replaceAssetIds, scrubForPublish, type Doc } from "@vash/schema";
import { and, eq, inArray } from "drizzle-orm";
import { assetKey, findUnusableAssets, storageUsedBytes } from "../assets/repository";
import { UPLOAD_LIMITS } from "../assets/service";
import { assets } from "../db/schema";
import type { Db } from "../db/types";
import type { CurrentUser } from "../deps";
import { insertDesign, type DesignRow } from "../designs/repository";
import { isUuid } from "../http/ids";
import { HttpError, unprocessable } from "../http/problem";
import { insertWithinQuota } from "../quotas";
import { copyAll, queueObjects, type Copy } from "../storage/copies";
import type { ObjectStorage } from "../storage/types";
import { openShare } from "./service";

const overQuota = (used: number) =>
  unprocessable("Remixing this design would go over your 500 MB of storage. Delete some photos to make room.", {
    limitBytes: UPLOAD_LIMITS.storageQuotaBytes,
    usedBytes: used,
  });

/**
 * Journey 4. The remixer gets their own design with copies of the sharer's photos (counted toward
 * the remixer's quota), so nothing the sharer does later can change it. Photos that no longer
 * exist, or that the remixer couldn't use, become empty placeholders.
 */
export async function remixShare(ctx: { db: Db; now: () => Date; storage: ObjectStorage | null }, remixer: CurrentUser, token: string): Promise<DesignRow> {
  const { design } = await openShare(ctx.db, token);
  const ids = [...referencedAssetIds(design.doc)].filter(isUuid);
  const owned =
    ids.length === 0
      ? []
      : await ctx.db
          .select()
          .from(assets)
          .where(and(inArray(assets.id, ids), eq(assets.ownerId, design.ownerId), eq(assets.status, "ready"), eq(assets.kind, "photo")));
  const ownedIds = new Set(owned.map((a) => a.id));
  const others = Object.values(design.doc.assets).filter((a) => !ownedIds.has(a.id));
  const unusable = new Set(await findUnusableAssets(ctx.db, remixer.id, others));
  const scrubbed = scrubForPublish(design.doc, new Set(Object.keys(design.doc.assets).filter((id) => ownedIds.has(id) || !unusable.has(id))));

  const copies = owned.map((source) => ({ source, id: randomUUID() }));
  if (copies.length > 0 && !ctx.storage) throw new HttpError(503, "Service Unavailable", "Photo storage isn't configured on this server.");
  const bytes = copies.reduce((n, c) => n + c.source.bytes, 0);
  const used = await storageUsedBytes(ctx.db, remixer.id);
  if (used + bytes > UPLOAD_LIMITS.storageQuotaBytes) throw overQuota(used);

  const designId = randomUUID();
  const now = ctx.now();
  const title = `Remix of ${design.title}`.slice(0, LIMITS.titleChars);
  const renamed = replaceAssetIds(scrubbed, new Map(copies.map((c) => [c.source.id, c.id])));
  const doc: Doc = { ...renamed, id: designId, kind: "design", meta: { ...renamed.meta, title } };

  const objects: Copy[] = copies.map((c) => ({ from: { bucket: "private", key: c.source.storageKey }, to: { bucket: "private", key: assetKey(remixer.id, c.id) } }));
  if (ctx.storage) await copyAll(ctx.db, ctx.storage, objects, now);
  try {
    // insertWithinQuota holds the remixer's row lock, which also serializes the storage quota check.
    return await insertWithinQuota(ctx.db, remixer.id, "designs", async (tx) => {
      const usedNow = await storageUsedBytes(tx, remixer.id);
      if (usedNow + bytes > UPLOAD_LIMITS.storageQuotaBytes) throw overQuota(usedNow);
      if (copies.length > 0) {
        await tx.insert(assets).values(
          copies.map((c) => ({
            id: c.id,
            ownerId: remixer.id,
            kind: "photo" as const,
            visibility: "private" as const,
            status: "ready" as const,
            storageKey: assetKey(remixer.id, c.id),
            mime: c.source.mime,
            bytes: c.source.bytes,
            width: c.source.width,
            height: c.source.height,
            createdAt: now,
            updatedAt: now,
          })),
        );
      }
      return insertDesign(tx, {
        id: designId,
        ownerId: remixer.id,
        folderId: null,
        title,
        doc,
        sourceTemplateId: design.sourceTemplateId,
        sourceTemplateVersion: design.sourceTemplateVersion,
        createdAt: now,
        updatedAt: now,
      });
    });
  } catch (err) {
    await queueObjects(ctx.db, objects.map((o) => o.to), now);
    throw err;
  }
}
```

In `apps/web/src/server/shares/handlers.ts`, add `import { toDesignJson } from "../designs/handlers";` and `import { remixShare } from "./remix";`, then the endpoint:

```ts
    remix: endpoint(deps, { auth: "user", rateLimit: { name: "designCreate", rule: RATE_LIMITS.designCreate, by: "user" } }, async ({ user, params }) => {
      const design = await remixShare({ ...ctx, storage }, user, params.token ?? "");
      return Response.json(toDesignJson(design), { status: 201 });
    }),
```

Create `apps/web/src/app/api/shared/[token]/remix/route.ts` with `export const POST = route((app) => app.shares.remix);`.

- [ ] **Step 3: Run the tests**

Run: `corepack pnpm --filter @vash/web exec vitest run src/server/shares && corepack pnpm --filter @vash/web typecheck`
Expected: all pass.

- [ ] **Step 4: Record the decision**

Append to `docs/decisions.md`:

```
| 36 | 2026-09-26 | **Remix copies the sharer's photos into the remixer's account** (`u/{remixer}/{id}`, private, ready), counted toward the remixer's 500 MB and design quota; public and system assets are referenced as they are; photos that are gone or unusable become empty placeholders, so the remix always saves. | "A copy (with copied photos)" (journey 4); the sharer deleting a photo can't break the remix, and remixing can't be used to dodge the quota. |
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/server/shares apps/web/src/app/api/shared docs/decisions.md
git commit -m "feat(web): remix a shared design with copies of its photos"
```

---

### Task 8: Public creator profiles

**Files:**
- Create: `apps/web/src/server/users/repository.ts`, `apps/web/src/server/users/handlers.ts`, `apps/web/src/server/users/users.test.ts`, `apps/web/src/app/api/users/[handle]/route.ts`
- Modify: `apps/web/src/server/context.ts`

**Interfaces:**
- Consumes: `galleryPage` (Task 2).
- Produces:
  - `getPublicProfile(db, handle): Promise<PublicProfileRow | undefined>`.
  - `userHandlers(deps)` with `get`.
  - `app.users`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/server/users/users.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../../tests/support/db";
import { testDeps } from "../../../tests/support/deps";
import { createTemplate, createUser } from "../../../tests/support/factories";
import { call } from "../../../tests/support/invoke";
import { userHandlers } from "./handlers";

let t: TestDb;
let h: ReturnType<typeof userHandlers>;
beforeAll(async () => {
  t = await createTestDb();
  h = userHandlers(testDeps(t.db));
});
afterAll(() => t.close());

const profile = (handle: string, query = "") => call(h.get, { path: `/api/users/${handle}${query}`, params: { handle } });

describe("GET /api/users/:handle", () => {
  it("shows a creator's public profile and published templates, and nothing private", async () => {
    const alice = await createUser(t.db, { handle: `a_${randomUUID().slice(0, 8)}`, name: "Alice" });
    const older = await createTemplate(t.db, { authorId: alice.id, usesCount: 3, createdAt: new Date("2026-09-01T00:00:00Z") });
    const newer = await createTemplate(t.db, { authorId: alice.id, usesCount: 4, createdAt: new Date("2026-09-02T00:00:00Z") });
    await createTemplate(t.db, { authorId: alice.id, usesCount: 10, status: "hidden" });
    await createTemplate(t.db, { usesCount: 50 });
    const res = await profile(alice.handle!);
    expect(res.status).toBe(200);
    expect(res.body.profile).toEqual({ handle: alice.handle, name: "Alice", image: null, joinedAt: alice.createdAt.toISOString(), templates: 2, uses: 7 });
    expect(res.body.templates.items.map((i: { id: string }) => i.id)).toEqual([newer.id, older.id]);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(alice.email);
    expect(text).not.toContain(alice.id);
  });

  it("matches handles case-insensitively and answers 404 for unknown or malformed ones", async () => {
    const bob = await createUser(t.db, { handle: `b_${randomUUID().slice(0, 8)}` });
    expect((await profile(bob.handle!.toUpperCase())).status).toBe(200);
    expect((await profile("nobody_here_at_all")).status).toBe(404);
    expect((await profile("a!")).status).toBe(404);
  });

  it("pages through a creator's templates", async () => {
    const carol = await createUser(t.db, { handle: `c_${randomUUID().slice(0, 8)}` });
    for (let d = 1; d <= 3; d++) await createTemplate(t.db, { authorId: carol.id, createdAt: new Date(`2026-09-0${d}T00:00:00Z`) });
    const first = await profile(carol.handle!, "?limit=2");
    expect(first.body.templates.items).toHaveLength(2);
    const second = await profile(carol.handle!, `?limit=2&cursor=${first.body.templates.nextCursor}`);
    expect(second.body.templates).toMatchObject({ nextCursor: null });
    expect(second.body.templates.items).toHaveLength(1);
  });
});
```

Run: `corepack pnpm --filter @vash/web exec vitest run src/server/users`. Expected: FAIL, because `./handlers` doesn't exist.

- [ ] **Step 2: Implement**

Create `apps/web/src/server/users/repository.ts`:

```ts
import { eq, sql } from "drizzle-orm";
import { templates, user } from "../db/schema";
import type { Db } from "../db/types";

export interface PublicProfileRow {
  id: string;
  handle: string | null;
  name: string;
  image: string | null;
  createdAt: Date;
  templates: number;
  uses: number;
}

/** Counts cover published templates only, like everything else the public sees. */
export async function getPublicProfile(db: Db, handle: string): Promise<PublicProfileRow | undefined> {
  const published = sql`${templates.authorId} = ${user.id} and ${templates.status} = 'published'`;
  const [row] = await db
    .select({
      id: user.id,
      handle: user.handle,
      name: user.name,
      image: user.image,
      createdAt: user.createdAt,
      templates: sql<number>`(select count(*)::int from ${templates} where ${published})`,
      uses: sql<number>`(select coalesce(sum(${templates.usesCount}), 0)::int from ${templates} where ${published})`,
    })
    .from(user)
    .where(eq(user.handle, handle));
  return row;
}
```

Create `apps/web/src/server/users/handlers.ts`:

```ts
import type { Deps } from "../deps";
import { readQuery } from "../http/body";
import { pageQuery } from "../http/cursor";
import { endpoint } from "../http/endpoint";
import { notFound } from "../http/problem";
import { RATE_LIMITS } from "../rate-limit/rules";
import { galleryPage } from "../templates/gallery";
import { getPublicProfile } from "./repository";

/** Same shape /api/me accepts; handles are stored lowercase. */
const HANDLE = /^[a-z0-9_]{3,30}$/;

export function userHandlers(deps: Deps) {
  return {
    get: endpoint(deps, { auth: "none", rateLimit: { name: "publicRead", rule: RATE_LIMITS.publicRead, by: "ip" } }, async ({ req, params }) => {
      const handle = (params.handle ?? "").toLowerCase();
      if (!HANDLE.test(handle)) throw notFound();
      const q = readQuery(req, pageQuery);
      const p = await getPublicProfile(deps.db, handle);
      if (!p) throw notFound();
      const page = await galleryPage(deps.db, { authorId: p.id, sort: "new", cursor: q.cursor, limit: q.limit });
      return Response.json({
        profile: { handle: p.handle, name: p.name, image: p.image, joinedAt: p.createdAt.toISOString(), templates: p.templates, uses: p.uses },
        templates: page,
      });
    }),
  };
}
```

Create `apps/web/src/app/api/users/[handle]/route.ts` with `export const GET = route((app) => app.users.get);`.

In `apps/web/src/server/context.ts`, add `import { userHandlers } from "./users/handlers";` and `users: userHandlers(deps),`.

- [ ] **Step 3: Run the tests**

Run: `corepack pnpm --filter @vash/web exec vitest run src/server/users && corepack pnpm --filter @vash/web typecheck`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/server/users apps/web/src/app/api/users apps/web/src/server/context.ts
git commit -m "feat(web): public creator profiles with published templates and stats"
```

---

### Task 9: Report a template

**Files:**
- Create: `apps/web/src/server/templates/reports.ts`, `apps/web/src/server/templates/reports.test.ts`, `apps/web/src/app/api/templates/[id]/reports/route.ts`
- Modify: `apps/web/src/server/templates/handlers.ts`, `docs/decisions.md`

**Interfaces:**
- Consumes: `getTemplateCard`.
- Produces: `reportTemplate(db, reporter, templateId, input, now)`; `templateHandlers(...).report`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/server/templates/reports.test.ts`:

```ts
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
```

Run: `corepack pnpm --filter @vash/web exec vitest run src/server/templates/reports.test.ts`. Expected: FAIL, because `h.report` is undefined.

- [ ] **Step 2: Implement**

Create `apps/web/src/server/templates/reports.ts`:

```ts
import { isForeignKeyViolation, isUniqueViolation } from "../db/errors";
import { reports } from "../db/schema";
import type { Db } from "../db/types";
import type { CurrentUser } from "../deps";
import { conflict, notFound, unprocessable } from "../http/problem";
import { getTemplateCard } from "./repository";

export type ReportReason = (typeof reports.$inferInsert)["reason"];

/** Only published templates can be reported; the unique (template, reporter) key dedupes. */
export async function reportTemplate(db: Db, reporter: CurrentUser, templateId: string, input: { reason: ReportReason; note: string }, now: Date) {
  const card = await getTemplateCard(db, templateId);
  if (card?.status !== "published") throw notFound();
  if (card.authorId === reporter.id) throw unprocessable("You can't report your own template.");
  try {
    const [row] = await db.insert(reports).values({ templateId, reporterId: reporter.id, reason: input.reason, note: input.note, createdAt: now }).returning();
    return row!;
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("You've already reported this template.");
    if (isForeignKeyViolation(err)) throw notFound();
    throw err;
  }
}
```

In `apps/web/src/server/templates/handlers.ts`, add `import { reportTemplate } from "./reports";` and:

```ts
const ReportBody = z
  .object({ reason: z.enum(["spam", "inappropriate", "copyright", "privacy", "other"]), note: z.string().trim().max(1000).default("") })
  .strict();
```

then the endpoint:

```ts
    report: endpoint(deps, { auth: "user", rateLimit: { name: "report", rule: RATE_LIMITS.report, by: "user" } }, async ({ req, user, params }) => {
      const id = parseId(params.id);
      const row = await reportTemplate(deps.db, user, id, await readJson(req, ReportBody), deps.now());
      return Response.json({ id: row.id, reason: row.reason, status: row.status, createdAt: row.createdAt.toISOString() }, { status: 201 });
    }),
```

Create `apps/web/src/app/api/templates/[id]/reports/route.ts` with `export const POST = route((app) => app.templates.report);`.

- [ ] **Step 3: Run the tests**

Run: `corepack pnpm --filter @vash/web exec vitest run src/server/templates && corepack pnpm --filter @vash/web typecheck`
Expected: all pass.

- [ ] **Step 4: Record the decision**

Append to `docs/decisions.md`:

```
| 37 | 2026-09-26 | **Reports:** only published templates can be reported (hidden ones answer 404); authors can't report their own (422); a second report from the same user answers 409; notes are at most 1,000 characters. | Keeps the queue meaningful and the dedupe explicit. |
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/server/templates apps/web/src/app/api/templates docs/decisions.md
git commit -m "feat(web): report a template, once per user"
```

---

### Task 10: Admin moderation

**Files:**
- Create:
  - `apps/web/src/server/admin/repository.ts`, `apps/web/src/server/admin/service.ts`, `apps/web/src/server/admin/handlers.ts`, `apps/web/src/server/admin/admin.test.ts`
  - `apps/web/src/app/api/admin/reports/route.ts`, `apps/web/src/app/api/admin/reports/[id]/resolve/route.ts`
  - `apps/web/src/app/api/admin/templates/route.ts`, `apps/web/src/app/api/admin/templates/[id]/moderate/route.ts`
- Modify: `apps/web/src/server/context.ts`, `docs/decisions.md`

**Interfaces:**
- Consumes: `getTemplateCard`, `listTemplatesByStatus`, `toTemplateJson`.
- Produces:
  - `listReports(db, q)`.
  - `resolveReport(db, admin, id, status, now)`.
  - `moderateTemplate(db, admin, id, action, now)`.
  - `adminHandlers(deps)` with `reports`, `resolveReport`, `moderate` and `templates`.
  - `app.admin`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/server/admin/admin.test.ts`:

```ts
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

  it("lists open reports oldest first, with the template, its author and the reporter", async () => {
    const admin = await createUser(t.db, { role: "admin" });
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
    const admin = await createUser(t.db, { role: "admin" });
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
    const admin = await createUser(t.db, { role: "admin" });
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
    const admin = await createUser(t.db, { role: "admin" });
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
```

Run: `corepack pnpm --filter @vash/web exec vitest run src/server/admin`. Expected: FAIL, because `./handlers` doesn't exist.

- [ ] **Step 2: Implement**

Create `apps/web/src/server/admin/repository.ts`:

```ts
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { reports, templates, user } from "../db/schema";
import type { Db } from "../db/types";
import type { Cursor } from "../http/cursor";

export type ReportStatus = (typeof reports.$inferSelect)["status"];

const author = alias(user, "author");
const reporter = alias(user, "reporter");

/** The open queue reads oldest first (work it in order); resolved lists read newest first. */
export function listReports(db: Db, q: { status: ReportStatus; after?: Cursor; limit: number }) {
  const oldestFirst = q.status === "open";
  const keyset = q.after
    ? oldestFirst
      ? sql`(${reports.createdAt}, ${reports.id}) > (${q.after.at}::timestamptz, ${q.after.id}::uuid)`
      : sql`(${reports.createdAt}, ${reports.id}) < (${q.after.at}::timestamptz, ${q.after.id}::uuid)`
    : undefined;
  return db
    .select({
      id: reports.id,
      reason: reports.reason,
      note: reports.note,
      status: reports.status,
      createdAt: reports.createdAt,
      resolvedAt: reports.resolvedAt,
      reporterHandle: reporter.handle,
      templateId: templates.id,
      templateTitle: templates.title,
      templateStatus: templates.status,
      templateFeatured: templates.featured,
      authorHandle: author.handle,
    })
    .from(reports)
    .innerJoin(templates, eq(templates.id, reports.templateId))
    .innerJoin(reporter, eq(reporter.id, reports.reporterId))
    .leftJoin(author, eq(author.id, templates.authorId))
    .where(and(eq(reports.status, q.status), keyset))
    .orderBy(...(oldestFirst ? [asc(reports.createdAt), asc(reports.id)] : [desc(reports.createdAt), desc(reports.id)]))
    .limit(q.limit + 1);
}

export type ReportListRow = Awaited<ReturnType<typeof listReports>>[number];
```

Create `apps/web/src/server/admin/service.ts`:

```ts
import { and, eq } from "drizzle-orm";
import { auditLog, reports, templates } from "../db/schema";
import type { Db } from "../db/types";
import type { CurrentUser } from "../deps";
import { conflict, notFound } from "../http/problem";

export type ModerationAction = "hide" | "restore" | "feature" | "unfeature";

const CHANGES: Record<ModerationAction, { status?: "published" | "hidden"; featured?: boolean }> = {
  hide: { status: "hidden", featured: false },
  restore: { status: "published" },
  feature: { featured: true },
  unfeature: { featured: false },
};

/** Every admin action is written to audit_log in the same transaction as the change (spec §8.4). */
export async function resolveReport(db: Db, admin: CurrentUser, reportId: string, status: "actioned" | "dismissed", now: Date) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(reports)
      .set({ status, resolvedBy: admin.id, resolvedAt: now })
      .where(and(eq(reports.id, reportId), eq(reports.status, "open")))
      .returning();
    if (!row) {
      const [exists] = await tx.select({ id: reports.id }).from(reports).where(eq(reports.id, reportId));
      throw exists ? conflict("This report has already been resolved.") : notFound();
    }
    await tx.insert(auditLog).values({ actorId: admin.id, action: "report.resolve", targetType: "report", targetId: reportId, meta: { status, templateId: row.templateId }, createdAt: now });
    return row;
  });
}

/** Hiding also unfeatures the template and closes its open reports as actioned. */
export async function moderateTemplate(db: Db, admin: CurrentUser, templateId: string, action: ModerationAction, now: Date): Promise<void> {
  await db.transaction(async (tx) => {
    const [tpl] = await tx.select({ status: templates.status }).from(templates).where(eq(templates.id, templateId)).for("update");
    if (!tpl) throw notFound();
    if (action === "feature" && tpl.status === "hidden") throw conflict("Restore this template before featuring it.");
    await tx.update(templates).set(CHANGES[action]).where(eq(templates.id, templateId));
    let reportsResolved = 0;
    if (action === "hide") {
      const closed = await tx
        .update(reports)
        .set({ status: "actioned", resolvedBy: admin.id, resolvedAt: now })
        .where(and(eq(reports.templateId, templateId), eq(reports.status, "open")))
        .returning({ id: reports.id });
      reportsResolved = closed.length;
    }
    await tx.insert(auditLog).values({ actorId: admin.id, action: `template.${action}`, targetType: "template", targetId: templateId, meta: { reportsResolved }, createdAt: now });
  });
}
```

Create `apps/web/src/server/admin/handlers.ts`:

```ts
import { z } from "zod";
import type { Deps } from "../deps";
import { readJson, readQuery } from "../http/body";
import { decodeCursor, pageQuery, toPage } from "../http/cursor";
import { endpoint } from "../http/endpoint";
import { parseId } from "../http/ids";
import { notFound } from "../http/problem";
import { RATE_LIMITS } from "../rate-limit/rules";
import { getTemplateCard, listTemplatesByStatus } from "../templates/repository";
import { toTemplateJson } from "../templates/view";
import { listReports, type ReportListRow } from "./repository";
import { moderateTemplate, resolveReport } from "./service";

const writeLimit = { name: "userWrite", rule: RATE_LIMITS.userWrite, by: "user" } as const;
const ReportsQuery = pageQuery.extend({ status: z.enum(["open", "actioned", "dismissed"]).default("open") });
const TemplatesQuery = pageQuery.extend({ status: z.enum(["published", "hidden"]).default("hidden"), featured: z.enum(["true"]).optional() });
const ResolveBody = z.object({ status: z.enum(["actioned", "dismissed"]) }).strict();
const ModerateBody = z.object({ action: z.enum(["hide", "restore", "feature", "unfeature"]) }).strict();

const reportJson = (r: ReportListRow) => ({
  id: r.id,
  reason: r.reason,
  note: r.note,
  status: r.status,
  createdAt: r.createdAt.toISOString(),
  resolvedAt: r.resolvedAt?.toISOString() ?? null,
  reporterHandle: r.reporterHandle,
  template: { id: r.templateId, title: r.templateTitle, status: r.templateStatus, featured: r.templateFeatured, authorHandle: r.authorHandle },
});

export function adminHandlers(deps: Deps) {
  return {
    reports: endpoint(deps, { auth: "admin" }, async ({ req }) => {
      const q = readQuery(req, ReportsQuery);
      const rows = await listReports(deps.db, { status: q.status, after: q.cursor ? decodeCursor(q.cursor) : undefined, limit: q.limit });
      return Response.json(toPage(rows, q.limit, (r) => ({ at: r.createdAt.toISOString(), id: r.id }), reportJson));
    }),

    resolveReport: endpoint(deps, { auth: "admin", rateLimit: writeLimit }, async ({ req, user, params }) => {
      const id = parseId(params.id);
      const { status } = await readJson(req, ResolveBody);
      const row = await resolveReport(deps.db, user, id, status, deps.now());
      return Response.json({ id: row.id, status: row.status, resolvedAt: row.resolvedAt?.toISOString() ?? null });
    }),

    moderate: endpoint(deps, { auth: "admin", rateLimit: writeLimit }, async ({ req, user, params }) => {
      const id = parseId(params.id);
      const { action } = await readJson(req, ModerateBody);
      await moderateTemplate(deps.db, user, id, action, deps.now());
      const card = await getTemplateCard(deps.db, id);
      if (!card) throw notFound();
      return Response.json(toTemplateJson(card));
    }),

    templates: endpoint(deps, { auth: "admin" }, async ({ req }) => {
      const q = readQuery(req, TemplatesQuery);
      const rows = await listTemplatesByStatus(deps.db, { status: q.status, featured: q.featured === "true", after: q.cursor ? decodeCursor(q.cursor) : undefined, limit: q.limit });
      return Response.json(toPage(rows, q.limit, (r) => ({ at: r.createdAt.toISOString(), id: r.id }), toTemplateJson));
    }),
  };
}
```

Create the routes, each with the one-line `route` pattern:
- `apps/web/src/app/api/admin/reports/route.ts`: `GET` = `app.admin.reports`.
- `apps/web/src/app/api/admin/reports/[id]/resolve/route.ts`: `POST` = `app.admin.resolveReport`.
- `apps/web/src/app/api/admin/templates/route.ts`: `GET` = `app.admin.templates`.
- `apps/web/src/app/api/admin/templates/[id]/moderate/route.ts`: `POST` = `app.admin.moderate`.

In `apps/web/src/server/context.ts`, add `import { adminHandlers } from "./admin/handlers";` and `admin: adminHandlers(deps),`.

- [ ] **Step 3: Run the tests**

Run: `corepack pnpm --filter @vash/web exec vitest run src/server/admin && corepack pnpm --filter @vash/web typecheck`
Expected: all pass.

- [ ] **Step 4: Record the decision**

Append to `docs/decisions.md`:

```
| 38 | 2026-09-26 | **Moderation:** hiding a template unfeatures it and closes its open reports as `actioned`; a hidden template can't be featured until restored. `GET /api/admin/templates?status=hidden\|published[&featured=true]` (not in §9.3) backs the Hidden and Featured tabs. Each change and its `audit_log` row are written in one transaction. | The brief's moderation tabs; one action clears the queue for a removed template; the audit trail can't miss a change. |
```

- [ ] **Step 5: Full verification and commit**

Run: `corepack pnpm -r lint && corepack pnpm -r typecheck && corepack pnpm -r test && corepack pnpm --filter @vash/web build`
Expected: all green. The build lists every new route under `/api`.

```bash
git add apps/web/src/server/admin apps/web/src/app/api/admin apps/web/src/server/context.ts docs/decisions.md
git commit -m "feat(web): admin moderation: report queue, resolve, hide/restore/feature, audit log"
```

---

## Self-Review Notes

- **Spec coverage:**
  - §9.3 Share, all four endpoints: Tasks 6 and 7. Also adds `GET /api/designs/:id/share`.
  - §9.3 Templates, all seven endpoints: Tasks 2, 3, 4, 5 and 9.
  - §9.3 Users: Task 8.
  - §9.3 Admin, all three endpoints: Task 10. Also adds `GET /api/admin/templates`.
  - §8.2 use counting: Task 3.
  - §8.3 `db:seed`: Task 1.
  - §8.4 steps 2, 5 and 6: Tasks 4, 5 and 10.
  - §9.5 share-link guessing and published-template leakage: Tasks 6 and 4–5.
  - §9.6 limits: each endpoint's `rateLimit`.
- **Deliberately not in this plan:**
  - Frontend pages: P1–P3 frontend plans.
  - Download permissions on shared views ("if owner allowed" in the brief). There is no column for it, and the viewer can render the canvas anyway.
  - Template deletion by authors: not in the spec. Admins hide instead.
- **Type consistency:** `TemplateCard`, `galleryPage`, `toTemplateJson`, `analyzeDraft`, `PUBLISH_LIMITS`, `ObjectRef`, `copyAll`, `queueObjects`, `openShare` and `toDesignJson` are each defined once and used under the same names later.

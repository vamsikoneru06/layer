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

/** Id and last change of published templates, newest first (served by templates_gallery_idx): the sitemap's template pages. */
export function listPublishedTemplateUrls(db: Db, limit: number): Promise<{ id: string; updatedAt: Date }[]> {
  return db
    .select({ id: templates.id, updatedAt: templates.updatedAt })
    .from(templates)
    .where(eq(templates.status, "published"))
    .orderBy(desc(templates.createdAt), desc(templates.id))
    .limit(limit);
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

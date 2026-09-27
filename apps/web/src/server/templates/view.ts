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

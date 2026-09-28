import { randomUUID } from "node:crypto";
import type { Doc } from "@vash/schema";
import { assets, designs, folders, templates, templateVersions, user } from "@/server/db/schema";
import type { Db } from "@/server/db/types";
import { templateDoc } from "./docs";

export async function createUser(db: Db, overrides: Partial<typeof user.$inferInsert> = {}) {
  const id = overrides.id ?? `u_${randomUUID()}`;
  const [row] = await db
    .insert(user)
    .values({ id, name: "Test User", email: `${id}@example.test`, emailVerified: true, ...overrides })
    .returning();
  if (!row) throw new Error("user insert returned nothing");
  return row;
}

export async function createFolder(db: Db, ownerId: string, name = "Birthdays") {
  const [row] = await db.insert(folders).values({ ownerId, name }).returning();
  if (!row) throw new Error("folder insert returned nothing");
  return row;
}

export async function createAsset(db: Db, overrides: Partial<typeof assets.$inferInsert> & { ownerId: string | null }) {
  const id = overrides.id ?? randomUUID();
  const [row] = await db
    .insert(assets)
    .values({
      id,
      kind: "photo",
      visibility: "private",
      status: "ready",
      storageKey: `u/${overrides.ownerId ?? "system"}/${id}`,
      mime: "image/jpeg",
      bytes: 1_000,
      width: 1200,
      height: 900,
      ...overrides,
    })
    .returning();
  if (!row) throw new Error("asset insert returned nothing");
  return row;
}

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

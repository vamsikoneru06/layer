import { asc, eq } from "drizzle-orm";
import { assets, auditLog, designs, folders, storageDeletions, templates, user } from "../db/schema";
import { isUniqueViolation } from "../db/errors";
import type { Db } from "../db/types";
import { conflict, notFound, unprocessable } from "../http/problem";

type UserRow = typeof user.$inferSelect;

export const toProfile = (u: UserRow) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  image: u.image,
  handle: u.handle,
  role: u.role,
  interests: u.interests,
  onboardedAt: u.onboardedAt?.toISOString() ?? null,
  createdAt: u.createdAt.toISOString(),
});

export async function getProfile(db: Db, userId: string): Promise<UserRow> {
  const [row] = await db.select().from(user).where(eq(user.id, userId));
  if (!row) throw notFound();
  return row;
}

export interface ProfilePatch {
  name?: string;
  handle?: string;
  interests?: string[];
  completeOnboarding?: true;
}

export async function updateProfile(db: Db, userId: string, patch: ProfilePatch, now: Date): Promise<UserRow> {
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .update(user)
        .set({
          updatedAt: now,
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.handle !== undefined ? { handle: patch.handle } : {}),
          ...(patch.interests !== undefined ? { interests: [...new Set(patch.interests)] } : {}),
        })
        .where(eq(user.id, userId))
        .returning();
      if (!row) throw notFound();
      if (!patch.completeOnboarding || row.onboardedAt) return row;
      if (!row.handle) throw unprocessable("Choose a handle before finishing onboarding.");
      const [done] = await tx.update(user).set({ onboardedAt: now }).where(eq(user.id, userId)).returning();
      return done!;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("That handle is already taken.");
    throw err;
  }
}

/** One transaction: queue object deletions, record the deletion, then cascade every owned row. */
export async function deleteAccount(db: Db, userId: string, now: Date): Promise<void> {
  await db.transaction(async (tx) => {
    const owned = await tx.select({ storageKey: assets.storageKey, visibility: assets.visibility }).from(assets).where(eq(assets.ownerId, userId));
    if (owned.length > 0) {
      await tx.insert(storageDeletions).values(owned.map((a) => ({ bucket: a.visibility, storageKey: a.storageKey, createdAt: now })));
    }
    await tx.insert(auditLog).values({
      actorId: userId,
      action: "account.delete",
      targetType: "user",
      targetId: userId,
      meta: { assets: owned.length },
      createdAt: now,
    });
    await tx.delete(user).where(eq(user.id, userId));
  });
}

export async function exportAccount(db: Db, userId: string, now: Date) {
  const profile = await getProfile(db, userId);
  const [folderRows, designRows, assetRows, templateRows] = await Promise.all([
    db.select({ id: folders.id, name: folders.name, createdAt: folders.createdAt }).from(folders).where(eq(folders.ownerId, userId)).orderBy(asc(folders.createdAt)),
    db
      .select({ id: designs.id, title: designs.title, folderId: designs.folderId, doc: designs.doc, version: designs.version, createdAt: designs.createdAt, updatedAt: designs.updatedAt })
      .from(designs)
      .where(eq(designs.ownerId, userId))
      .orderBy(asc(designs.createdAt)),
    db
      .select({ id: assets.id, kind: assets.kind, visibility: assets.visibility, mime: assets.mime, bytes: assets.bytes, width: assets.width, height: assets.height, createdAt: assets.createdAt })
      .from(assets)
      .where(eq(assets.ownerId, userId)),
    db
      .select({ id: templates.id, title: templates.title, description: templates.description, category: templates.category, tags: templates.tags, status: templates.status, currentVersion: templates.currentVersion, createdAt: templates.createdAt })
      .from(templates)
      .where(eq(templates.authorId, userId)),
  ]);
  return { exportedAt: now.toISOString(), profile: toProfile(profile), folders: folderRows, designs: designRows, assets: assetRows, templates: templateRows };
}

import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import { assets, auditLog, bugReports, designs, folders, storageDeletions, templates, user } from "../db/schema";
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
    // FOR UPDATE conflicts with the FK share-lock an asset insert takes on its owner, so no asset can
    // appear after the SELECT below and be cascade-deleted without its storage key being queued.
    await tx.select({ id: user.id }).from(user).where(eq(user.id, userId)).for("update");
    const owned = await tx
      .select({ storageKey: assets.storageKey, visibility: assets.visibility })
      .from(assets)
      .where(or(eq(assets.ownerId, userId), inArray(assets.templateId, tx.select({ id: templates.id }).from(templates).where(eq(templates.authorId, userId)))));
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

export const EXPORT_PAGE_SIZE = 20;

/**
 * The export as JSON text chunks. Designs (up to LIMITS.docBytes each) are read and emitted a page at
 * a time, so memory stays at one page whatever the account size. The first chunk runs every other
 * query, so errors like a missing user surface before the caller commits to a response.
 */
export async function* exportAccount(db: Db, userId: string, now: Date): AsyncGenerator<string> {
  const profile = await getProfile(db, userId);
  const [folderRows, assetRows, templateRows, bugReportRows] = await Promise.all([
    db.select({ id: folders.id, name: folders.name, createdAt: folders.createdAt }).from(folders).where(eq(folders.ownerId, userId)).orderBy(asc(folders.createdAt)),
    db
      .select({ id: assets.id, kind: assets.kind, visibility: assets.visibility, mime: assets.mime, bytes: assets.bytes, width: assets.width, height: assets.height, createdAt: assets.createdAt })
      .from(assets)
      .where(eq(assets.ownerId, userId)),
    db
      .select({ id: templates.id, title: templates.title, description: templates.description, category: templates.category, tags: templates.tags, status: templates.status, currentVersion: templates.currentVersion, createdAt: templates.createdAt })
      .from(templates)
      .where(eq(templates.authorId, userId)),
    db
      .select({ id: bugReports.id, summary: bugReports.summary, expected: bugReports.expected, steps: bugReports.steps, page: bugReports.page, userAgent: bugReports.userAgent, status: bugReports.status, createdAt: bugReports.createdAt })
      .from(bugReports)
      .where(eq(bugReports.reporterId, userId))
      .orderBy(asc(bugReports.createdAt)),
  ]);
  const head = {
    exportedAt: now.toISOString(),
    profile: toProfile(profile),
    folders: folderRows,
    assets: assetRows,
    templates: templateRows,
    bugReports: bugReportRows,
  };
  yield `${JSON.stringify(head).slice(0, -1)},"designs":[`;

  let after: { createdAt: Date; id: string } | undefined;
  let first = true;
  for (;;) {
    const page = await db
      .select({ id: designs.id, title: designs.title, folderId: designs.folderId, doc: designs.doc, version: designs.version, createdAt: designs.createdAt, updatedAt: designs.updatedAt })
      .from(designs)
      .where(
        and(
          eq(designs.ownerId, userId),
          after ? sql`(${designs.createdAt}, ${designs.id}) > (${after.createdAt.toISOString()}::timestamptz, ${after.id}::uuid)` : undefined,
        ),
      )
      .orderBy(asc(designs.createdAt), asc(designs.id))
      .limit(EXPORT_PAGE_SIZE);
    for (const row of page) {
      yield (first ? "" : ",") + JSON.stringify(row);
      first = false;
    }
    if (page.length < EXPORT_PAGE_SIZE) break;
    after = page.at(-1);
  }
  yield "]}";
}

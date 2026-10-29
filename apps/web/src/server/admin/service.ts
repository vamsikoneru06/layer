import { and, eq, inArray } from "drizzle-orm";
import { assets, auditLog, reports, storageDeletions, templates } from "../db/schema";
import type { Db } from "../db/types";
import type { CurrentUser } from "../deps";
import { outsideUserScope } from "../db/user-scope";
import { conflict, notFound } from "../http/problem";
import { copyAll, dropCopies, releaseCopies } from "../storage/copies";
import type { Bucket, ObjectStorage } from "../storage/types";

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

/** Hiding takes the template's photo copies off the public bucket; restoring puts them back. */
const MOVES: Partial<Record<ModerationAction, { from: Bucket; to: Bucket }>> = {
  hide: { from: "public", to: "private" },
  restore: { from: "private", to: "public" },
};

/**
 * Hiding also unfeatures the template, closes its open reports as actioned, and moves its photo copies to the private
 * bucket, so links to them stop working (admins still see them through signed URLs). Restoring moves them back.
 * The copies are made first (registered for deletion until the transaction records them); the objects they replace
 * go to the deletion queue in the same transaction, so a failure at any point leaves the template as it was.
 */
export function moderateTemplate(ctx: { db: Db; storage: ObjectStorage }, admin: CurrentUser, templateId: string, action: ModerationAction, now: Date): Promise<void> {
  // System work on rows no user owns (template copies) and other users' templates and reports, so it runs outside the
  // admin's row-level-security scope. Only admins reach it (admin endpoint, two-factor checked).
  return outsideUserScope(() => moderate(ctx, admin, templateId, action, now));
}

async function moderate(ctx: { db: Db; storage: ObjectStorage }, admin: CurrentUser, templateId: string, action: ModerationAction, now: Date): Promise<void> {
  const { db, storage } = ctx;
  const move = MOVES[action];
  const [current] = move ? await db.select({ authorId: templates.authorId }).from(templates).where(eq(templates.id, templateId)) : [];
  const photos = move && current ? await db.select({ id: assets.id, key: assets.storageKey, bytes: assets.bytes }).from(assets).where(and(eq(assets.templateId, templateId), eq(assets.visibility, move.from))) : [];
  const owner = current?.authorId ?? null;
  const reserved = move ? await copyAll(db, storage, photos.map((p) => ({ from: { bucket: move.from, key: p.key }, to: { bucket: move.to, key: p.key }, assetId: p.id, bytes: p.bytes })), owner, now) : [];
  try {
    await moderateInTransaction(db, admin, templateId, action, now, async (tx) => {
      if (!move || photos.length === 0) return 0;
      const flipped = await tx
        .update(assets)
        .set({ visibility: move.to, updatedAt: now })
        .where(and(eq(assets.templateId, templateId), eq(assets.visibility, move.from), inArray(assets.id, photos.map((p) => p.id))))
        .returning({ id: assets.id, key: assets.storageKey, bytes: assets.bytes });
      await releaseCopies(tx, reserved);
      if (flipped.length > 0) {
        await tx
          .insert(storageDeletions)
          .values(flipped.map((p) => ({ bucket: move.from, storageKey: p.key, ownerId: owner, assetId: p.id, bytes: p.bytes, createdAt: now, notBefore: now })));
      }
      return flipped.length;
    });
  } catch (err) {
    await dropCopies(db, reserved, now);
    throw err;
  }
}

async function moderateInTransaction(
  db: Db,
  admin: CurrentUser,
  templateId: string,
  action: ModerationAction,
  now: Date,
  movePhotos: (tx: Db) => Promise<number>,
): Promise<void> {
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
    const photosMoved = await movePhotos(tx as Db);
    await tx.insert(auditLog).values({ actorId: admin.id, action: `template.${action}`, targetType: "template", targetId: templateId, meta: { reportsResolved, photosMoved }, createdAt: now });
  });
}

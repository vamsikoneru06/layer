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
import { getTemplateWithDoc } from "./repository";
import { canSee } from "./view";

/** Spec §8.2: copies the current version into a new design; a signed-in use counts once per user per template per UTC day. */
export async function useTemplate(ctx: { db: Db; now: () => Date }, viewer: CurrentUser, templateId: string): Promise<DesignRow> {
  const card = await getTemplateWithDoc(ctx.db, templateId);
  if (!card || !canSee(card, viewer, ctx.now()) || !card.doc) throw notFound();
  const version = { version: card.currentVersion, doc: card.doc };
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

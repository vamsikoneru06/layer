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

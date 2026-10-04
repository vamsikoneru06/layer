import { randomUUID } from "node:crypto";
import { parseDoc, replaceAssetIds, type PiiFinding } from "@vash/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getOwnedAsset, storageUsedBytes } from "../assets/repository";
import { quotaFor, quotaMessage } from "../assets/service";
import { assets, templates, user } from "../db/schema";
import type { Db } from "../db/types";
import type { CurrentUser } from "../deps";
import { conflict, notFound, unprocessable } from "../http/problem";
import { copyAll, dropCopies, releaseCopies, type Copy } from "../storage/copies";
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

const overQuota = (quota: number, used: number) =>
  unprocessable(quotaMessage(quota, "Publishing these photos"), {
    limitBytes: quota,
    usedBytes: used,
  });

/**
 * Spec §8.4. Publishes a template draft as a new template (`templateId` null) or as the next version
 * of the author's template. Kept photos and the thumbnail become system-owned public copies, so the
 * author deleting an original never breaks the template; their bytes still count toward the author's quota.
 * A republish reuses the copies this template already has of the same originals, so it isn't charged twice.
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
  const sources = [...draft.kept, thumbnail];
  const reusable = existing
    ? await ctx.db
        .select({ id: assets.id, sourceAssetId: assets.sourceAssetId })
        .from(assets)
        .where(and(eq(assets.templateId, id), inArray(assets.sourceAssetId, sources.map((a) => a.id))))
    : [];
  const reuse = new Map(reusable.map((r) => [r.sourceAssetId, r.id]));
  const copies = sources.map((source) => ({ source, id: reuse.get(source.id) ?? randomUUID(), fresh: !reuse.has(source.id) }));
  const fresh = copies.filter((c) => c.fresh);
  const keyOf = (assetId: string) => `t/${id}/${assetId}`;
  const bytes = fresh.reduce((n, c) => n + c.source.bytes, 0);
  const used = await storageUsedBytes(ctx.db, author.id);
  const quota = quotaFor(ctx.storage);
  if (used + bytes > quota) throw overQuota(quota, used);

  // The thumbnail is always last and isn't referenced by the document.
  const renamed = replaceAssetIds(draft.doc, new Map(copies.slice(0, -1).map((c) => [c.source.id, c.id])));
  const parsed = parseDoc(
    { ...renamed, id, kind: "template", meta: { title: input.title, category: input.category, tags: input.tags, format: renamed.meta.format } },
    { kind: "template" },
  );
  if (!parsed.ok) throw unprocessable("Fix the template's problems before publishing.", { issues: parsed.issues.slice(0, 50) });
  const doc = parsed.doc;

  const objects: Copy[] = fresh.map((c) => ({
    from: { bucket: "private", key: c.source.storageKey },
    to: { bucket: "public", key: keyOf(c.id) },
    assetId: c.id,
    bytes: c.source.bytes,
  }));
  const reserved = await copyAll(ctx.db, ctx.storage, objects, author.id, now);
  try {
    await ctx.db.transaction(async (tx) => {
      // Same lock as uploads and account deletion: the quota check and these inserts can't interleave with either.
      const [me] = await tx.select({ id: user.id }).from(user).where(eq(user.id, author.id)).for("no key update");
      if (!me) throw notFound();
      // The copies were charged while in flight; release that first so they aren't counted twice.
      await releaseCopies(tx, reserved);
      const usedNow = await storageUsedBytes(tx, author.id);
      if (usedNow + bytes > quota) throw overQuota(quota, usedNow);
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
      if (fresh.length > 0) {
        await tx.insert(assets).values(
          fresh.map((c) => ({
            id: c.id,
            ownerId: null,
            templateId: id,
            sourceAssetId: c.source.id,
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
      }
      await insertTemplateVersion(tx, { templateId: id, version, doc, thumbnailAssetId: copies.at(-1)!.id, createdAt: now });
    });
  } catch (err) {
    await dropCopies(ctx.db, reserved, now);
    throw err;
  }
  return { template: (await getTemplateCard(ctx.db, id))!, pii: draft.pii };
}

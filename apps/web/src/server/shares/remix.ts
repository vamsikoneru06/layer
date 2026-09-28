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
import { truncate } from "../text";
import { copyAll, dropCopies, releaseCopies, type Copy } from "../storage/copies";
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
  const title = truncate(`Remix of ${design.title}`, LIMITS.titleChars);
  const renamed = replaceAssetIds(scrubbed, new Map(copies.map((c) => [c.source.id, c.id])));
  const doc: Doc = { ...renamed, id: designId, kind: "design", meta: { ...renamed.meta, title } };

  const objects: Copy[] = copies.map((c) => ({
    from: { bucket: "private", key: c.source.storageKey },
    to: { bucket: "private", key: assetKey(remixer.id, c.id) },
    assetId: c.id,
    bytes: c.source.bytes,
  }));
  const reserved = ctx.storage ? await copyAll(ctx.db, ctx.storage, objects, remixer.id, now) : [];
  try {
    // insertWithinQuota holds the remixer's row lock, which also serializes the storage quota check.
    return await insertWithinQuota(ctx.db, remixer.id, "designs", async (tx) => {
      // The copies were charged while in flight; release that first so they aren't counted twice.
      await releaseCopies(tx, reserved);
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
    await dropCopies(ctx.db, reserved, now);
    throw err;
  }
}

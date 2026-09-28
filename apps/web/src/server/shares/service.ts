import { referencedAssetIds } from "@vash/schema";
import { resolveAssets } from "../assets/service";
import type { Db } from "../db/types";
import { getDesignVersion } from "../designs/repository";
import { isUuid } from "../http/ids";
import { HttpError, notFound } from "../http/problem";
import type { ObjectStorage } from "../storage/types";
import { findShareByTokenHash, hashToken, insertShareLink, newShareToken, SHARE_TOKEN } from "./repository";

export async function createShare(ctx: { db: Db; now: () => Date }, ownerId: string, designId: string) {
  if ((await getDesignVersion(ctx.db, ownerId, designId)) === undefined) throw notFound();
  const token = newShareToken();
  const link = await insertShareLink(ctx.db, { designId, createdBy: ownerId, tokenHash: hashToken(token), now: ctx.now() });
  return { link, token };
}

/** 404 for a token that never existed; 410 for a revoked one, so the page can say so. */
export async function openShare(db: Db, token: string) {
  if (!SHARE_TOKEN.test(token)) throw notFound();
  const found = await findShareByTokenHash(db, hashToken(token));
  if (!found) throw notFound();
  if (found.link.revokedAt) throw new HttpError(410, "Gone", "This link has been turned off by its owner.");
  return found;
}

/** Read-only view. The token grants what the owner could see of this design's own photos, nothing else. */
export async function viewShare(ctx: { db: Db; now: () => Date; storage: ObjectStorage | null }, token: string) {
  const { design, ownerName, ownerHandle } = await openShare(ctx.db, token);
  const ids = [...referencedAssetIds(design.doc)].filter(isUuid);
  const assets = ctx.storage && ids.length > 0 ? await resolveAssets({ db: ctx.db, now: ctx.now, storage: ctx.storage }, design.ownerId, ids) : [];
  return {
    design: {
      title: design.title,
      format: design.doc.meta.format,
      width: design.doc.artboard.width,
      height: design.doc.artboard.height,
      doc: design.doc,
      updatedAt: design.updatedAt.toISOString(),
    },
    owner: { name: ownerName, handle: ownerHandle },
    assets,
  };
}

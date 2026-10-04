import { referencedAssetIds } from "@vash/schema";
import { and, count, eq, isNull } from "drizzle-orm";
import { resolveAssets } from "../assets/service";
import { designs, shareLinks } from "../db/schema";
import type { Db } from "../db/types";
import { isUuid } from "../http/ids";
import { HttpError, notFound, unprocessable } from "../http/problem";
import type { ObjectStorage } from "../storage/types";
import { findShareByTokenHash, hashToken, insertShareLink, newShareToken, SHARE_TOKEN } from "./repository";

/** Keeps every active link on one page of the owner's list, so each one can still be found and revoked. */
export const SHARE_LIMITS = { activePerDesign: 20 } as const;

export async function createShare(ctx: { db: Db; now: () => Date }, ownerId: string, designId: string) {
  const token = newShareToken();
  const link = await ctx.db.transaction(async (tx) => {
    // Locks the design, so two creates at the cap can't both pass the count.
    const [design] = await tx
      .select({ id: designs.id })
      .from(designs)
      .where(and(eq(designs.id, designId), eq(designs.ownerId, ownerId)))
      .for("no key update");
    if (!design) throw notFound();
    const [active] = await tx.select({ n: count() }).from(shareLinks).where(and(eq(shareLinks.designId, designId), isNull(shareLinks.revokedAt)));
    if ((active?.n ?? 0) >= SHARE_LIMITS.activePerDesign) {
      throw unprocessable(`A design can have at most ${SHARE_LIMITS.activePerDesign} active share links. Turn one off to make a new one.`, {
        limit: SHARE_LIMITS.activePerDesign,
      });
    }
    return insertShareLink(tx, { designId, createdBy: ownerId, tokenHash: hashToken(token), now: ctx.now() });
  });
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

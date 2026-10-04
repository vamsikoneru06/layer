import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { designs, shareLinks, user } from "../db/schema";
import type { Db } from "../db/types";
import type { DesignRow } from "../designs/repository";

/** 128 random bits, base64url-encoded: always 22 characters. */
export const SHARE_TOKEN = /^[A-Za-z0-9_-]{22}$/;
export const newShareToken = () => randomBytes(16).toString("base64url");
/** Only this hash is stored, so a database leak doesn't hand out working links. */
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export type ShareLinkRow = typeof shareLinks.$inferSelect;

export async function insertShareLink(db: Db, v: { designId: string; createdBy: string; tokenHash: string; now: Date }): Promise<ShareLinkRow> {
  const [row] = await db.insert(shareLinks).values({ designId: v.designId, createdBy: v.createdBy, tokenHash: v.tokenHash, createdAt: v.now }).returning();
  return row!;
}

/** Newest first; the caller has already checked that the design is theirs. */
export function listActiveShareLinks(db: Db, designId: string): Promise<ShareLinkRow[]> {
  return db
    .select()
    .from(shareLinks)
    .where(and(eq(shareLinks.designId, designId), isNull(shareLinks.revokedAt)))
    .orderBy(desc(shareLinks.createdAt), desc(shareLinks.id))
    .limit(100);
}

/** Idempotent. False when the link doesn't exist or the design isn't the owner's. */
export async function revokeShareLink(db: Db, ownerId: string, designId: string, linkId: string, now: Date): Promise<boolean> {
  const rows = await db
    .update(shareLinks)
    .set({ revokedAt: sql`coalesce(${shareLinks.revokedAt}, ${now.toISOString()}::timestamptz)` })
    .where(
      and(
        eq(shareLinks.id, linkId),
        eq(shareLinks.designId, designId),
        sql`exists (select 1 from ${designs} where ${designs.id} = ${shareLinks.designId} and ${designs.ownerId} = ${ownerId})`,
      ),
    )
    .returning({ id: shareLinks.id });
  return rows.length > 0;
}

export async function findShareByTokenHash(
  db: Db,
  tokenHash: string,
): Promise<{ link: ShareLinkRow; design: DesignRow; ownerName: string; ownerHandle: string | null } | undefined> {
  const [row] = await db
    .select({ link: shareLinks, design: designs, ownerName: user.name, ownerHandle: user.handle })
    .from(shareLinks)
    .innerJoin(designs, eq(designs.id, shareLinks.designId))
    .innerJoin(user, eq(user.id, designs.ownerId))
    .where(eq(shareLinks.tokenHash, tokenHash));
  return row;
}

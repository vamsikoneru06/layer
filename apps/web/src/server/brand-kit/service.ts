import { eq } from "drizzle-orm";
import { getOwnedAsset } from "../assets/repository";
import { isForeignKeyViolation } from "../db/errors";
import { brandKits } from "../db/schema";
import type { Db } from "../db/types";
import { unprocessable } from "../http/problem";

export interface BrandKit {
  colors: string[];
  fonts: string[];
  logoAssetId: string | null;
}

export const BRAND_KIT_LIMITS = { colors: 12, fonts: 4 } as const;

const EMPTY: BrandKit = { colors: [], fonts: [], logoAssetId: null };
const columns = { colors: brandKits.colors, fonts: brandKits.fonts, logoAssetId: brandKits.logoAssetId };

/** The user's kit, or an empty one before they save anything. */
export async function getBrandKit(db: Db, userId: string): Promise<BrandKit> {
  const [row] = await db.select(columns).from(brandKits).where(eq(brandKits.userId, userId));
  return row ?? EMPTY;
}

const notTheirPhoto = () => unprocessable("logoAssetId must be one of your uploaded photos.");

/** Replaces the kit. The logo must be one of the user's own uploaded, ready photos. */
export async function saveBrandKit(db: Db, userId: string, kit: BrandKit, now: Date): Promise<BrandKit> {
  if (kit.logoAssetId) {
    const logo = await getOwnedAsset(db, userId, kit.logoAssetId);
    if (logo?.status !== "ready" || logo.kind !== "photo") throw notTheirPhoto();
  }
  try {
    const [row] = await db
      .insert(brandKits)
      .values({ userId, ...kit, updatedAt: now })
      .onConflictDoUpdate({ target: brandKits.userId, set: { ...kit, updatedAt: now } })
      .returning(columns);
    return row!;
  } catch (err) {
    // The photo was deleted between the check and the write.
    if (isForeignKeyViolation(err)) throw notTheirPhoto();
    throw err;
  }
}

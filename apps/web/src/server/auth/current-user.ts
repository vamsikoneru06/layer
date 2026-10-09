import { and, eq } from "drizzle-orm";
import { session, user } from "../db/schema";
import type { Db } from "../db/types";
import type { CurrentUser } from "../deps";
import type { Auth } from "./auth";

/** The user, plus when `sessionId` last passed a two-factor code (null without a session). */
export async function loadCurrentUser(db: Db, id: string, sessionId: string | null = null): Promise<CurrentUser | null> {
  const [row] = await db
    .select({
      id: user.id,
      email: user.email,
      role: user.role,
      handle: user.handle,
      twoFactorEnabled: user.twoFactorEnabled,
      verifiedAt: session.twoFactorVerifiedAt,
    })
    .from(user)
    .leftJoin(session, and(eq(session.userId, user.id), eq(session.id, sessionId ?? "")))
    .where(eq(user.id, id));
  if (!row) return null;
  const { twoFactorEnabled, verifiedAt, ...rest } = row;
  return { ...rest, twoFactor: { enabled: twoFactorEnabled, verifiedAt } };
}

/** Session from Better Auth; role, handle and two-factor state from our own columns (Better Auth never sees them). */
export function createAuthenticator(auth: Pick<Auth, "api">, db: Db) {
  return async (req: Request): Promise<CurrentUser | null> => {
    const found = await auth.api.getSession({ headers: req.headers });
    return found ? loadCurrentUser(db, found.user.id, found.session.id) : null;
  };
}

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

type SessionUser = { id: string; email: string; role?: string | null; handle?: string | null; twoFactorEnabled?: boolean | null };

/**
 * The signed-in user on every request from Better Auth's session: one joined query (session + user), since role,
 * handle and twoFactorEnabled are read-only fields Better Auth returns. Only users with two-factor on (admins) need
 * a second query, for when this session last passed a code.
 */
export function createAuthenticator(auth: Pick<Auth, "api">, db: Db) {
  return async (req: Request): Promise<CurrentUser | null> => {
    const found = await auth.api.getSession({ headers: req.headers });
    if (!found) return null;
    const u = found.user as SessionUser;
    const enabled = u.twoFactorEnabled === true;
    let verifiedAt: Date | null = null;
    if (enabled) {
      const [row] = await db.select({ at: session.twoFactorVerifiedAt }).from(session).where(eq(session.id, found.session.id));
      verifiedAt = row?.at ?? null;
    }
    return { id: u.id, email: u.email, role: u.role === "admin" ? "admin" : "user", handle: u.handle ?? null, twoFactor: { enabled, verifiedAt } };
  };
}

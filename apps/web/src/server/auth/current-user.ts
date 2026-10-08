import type { CurrentUser } from "../deps";
import type { Auth } from "./auth";

/**
 * The signed-in user from Better Auth's session. One joined query (session + user) per request; the user row
 * carries our role and handle, declared to Better Auth as read-only fields.
 */
export function createAuthenticator(auth: Pick<Auth, "api">) {
  return async (req: Request): Promise<CurrentUser | null> => {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) return null;
    const u = session.user as typeof session.user & { role?: string | null; handle?: string | null };
    return { id: u.id, email: u.email, role: u.role === "admin" ? "admin" : "user", handle: u.handle ?? null };
  };
}

import { eq } from "drizzle-orm";
import { user } from "../db/schema";
import type { Db } from "../db/types";
import type { CurrentUser } from "../deps";
import type { Auth } from "./auth";

export async function loadCurrentUser(db: Db, id: string): Promise<CurrentUser | null> {
  const [row] = await db
    .select({ id: user.id, email: user.email, role: user.role, handle: user.handle })
    .from(user)
    .where(eq(user.id, id));
  return row ?? null;
}

/** Session from Better Auth; role and handle from our own columns (Better Auth never sees them). */
export function createAuthenticator(auth: Pick<Auth, "api">, db: Db) {
  return async (req: Request): Promise<CurrentUser | null> => {
    const session = await auth.api.getSession({ headers: req.headers });
    return session ? loadCurrentUser(db, session.user.id) : null;
  };
}

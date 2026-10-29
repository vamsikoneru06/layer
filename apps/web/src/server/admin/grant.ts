import { and, eq, ne, sql } from "drizzle-orm";
import { auditLog, user } from "../db/schema";
import type { Db } from "../db/types";

/**
 * Makes an existing account an admin (moderation needs one, and nothing in the app can create the first).
 * Run by the owner from a terminal (`pnpm admin:grant`), so the audit entry's actor is "operator".
 */
export async function grantAdmin(db: Db, email: string, now: Date): Promise<"granted" | "already" | "missing"> {
  const normalized = email.trim().toLowerCase();
  return db.transaction(async (tx) => {
    const [target] = await tx.select({ id: user.id, role: user.role }).from(user).where(eq(sql`lower(${user.email})`, normalized)).for("update");
    if (!target) return "missing";
    if (target.role === "admin") return "already";
    await tx.update(user).set({ role: "admin", updatedAt: now }).where(and(eq(user.id, target.id), ne(user.role, "admin")));
    await tx.insert(auditLog).values({ actorId: "operator", action: "user.grant_admin", targetType: "user", targetId: target.id, createdAt: now });
    return "granted";
  });
}

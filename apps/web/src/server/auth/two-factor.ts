import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { AppConfig } from "../config";
import { auditLog, session as sessions } from "../db/schema";
import type { Db } from "../db/types";
import type { CurrentUser } from "../deps";
import { HttpError, problem } from "../http/problem";
import type { Logger } from "../logging";
import { consume } from "../rate-limit/limiter";
import { RATE_LIMITS } from "../rate-limit/rules";
import type { Auth } from "./auth";
import { sessionCookieName } from "./cookies";
import { loadCurrentUser } from "./current-user";
import { twoFactorChangeEmail, type Mailer, type TwoFactorChange } from "./mailer";

/** What the audit log records: the changes the owner is emailed about, plus each code that unlocks admin tools. */
type TwoFactorEvent = TwoFactorChange | "verify";

const MINUTE = 60_000;
/** How long one code unlocks admin tools on a session. */
export const ADMIN_STEP_UP_MS = 12 * 60 * MINUTE;
/** Changing two-factor needs a code this recent; setting it up for the first time needs a sign-in this recent. */
const MANAGE_WINDOW_MS = 10 * MINUTE;

const VERIFY_PATHS = new Set(["/two-factor/verify-totp", "/two-factor/verify-backup-code"]);
const MANAGE_PATHS = new Set(["/two-factor/enable", "/two-factor/disable", "/two-factor/generate-backup-codes"]);

/** True when `user` may use admin powers right now: an admin with a recent two-factor code on this session. */
export function hasAdminAccess(user: CurrentUser, now: Date): boolean {
  const at = user.twoFactor.verifiedAt;
  return user.role === "admin" && user.twoFactor.enabled && at !== null && now.getTime() - at.getTime() <= ADMIN_STEP_UP_MS;
}

/** What Settings shows: whether two-factor is on, and until when this session's last code unlocks admin tools. */
export function twoFactorStatus(user: CurrentUser, now: Date): { enabled: boolean; unlockedUntil: string | null } {
  const until = user.twoFactor.verifiedAt ? user.twoFactor.verifiedAt.getTime() + ADMIN_STEP_UP_MS : 0;
  return { enabled: user.twoFactor.enabled, unlockedUntil: user.twoFactor.enabled && until > now.getTime() ? new Date(until).toISOString() : null };
}

/** Admin tools need two-factor set up and a code entered on this session recently. */
export function assertAdminStepUp(user: CurrentUser, now: Date): void {
  if (!user.twoFactor.enabled) {
    throw new HttpError(403, "Forbidden", "Set up two-step verification in Settings to use admin tools.", { code: "two_factor_setup_required" });
  }
  const at = user.twoFactor.verifiedAt;
  if (!at || now.getTime() - at.getTime() > ADMIN_STEP_UP_MS) {
    throw new HttpError(403, "Forbidden", "Enter a code from your authenticator app in Settings to use admin tools.", { code: "two_factor_required" });
  }
}

/**
 * VASH's rules around Better Auth's /two-factor/* routes. Its plugin only challenges password sign-ins, which VASH doesn't
 * have, and otherwise trusts any session. So here: admins only; a cap on codes tried; a stolen session can't set up its own
 * authenticator (needs a fresh sign-in) or turn two-factor off (needs a recent code); and a correct code is recorded on
 * the session, which is what admin tools check.
 */
export function twoFactorGuard({
  auth,
  db,
  config,
  now,
  mailer,
  logger,
}: {
  auth: Pick<Auth, "api">;
  db: Db;
  config: AppConfig;
  now: () => Date;
  mailer: Mailer;
  logger: Logger;
}) {
  const deny = (status: number, title: string, detail: string, extra?: Record<string, unknown>, headers?: Record<string, string>) =>
    problem(status, title, detail, randomUUID(), extra, headers);

  return {
    /** A response to send instead of Better Auth's, or null to let the request through. */
    async before(req: Request, path: string): Promise<Response | null> {
      if (!path.startsWith("/two-factor/")) return null;
      const found = await auth.api.getSession({ headers: req.headers });
      if (!found) return deny(401, "Unauthorized", "Sign in to continue.");
      const user = await loadCurrentUser(db, found.user.id, found.session.id);
      if (user?.role !== "admin") return deny(403, "Forbidden", "Two-step verification is for administrator accounts.");
      const at = now();

      if (VERIFY_PATHS.has(path)) {
        const verdict = await consume(db, `twoFactorVerify:user:${user.id}`, RATE_LIMITS.twoFactorVerify, at);
        if (!verdict.allowed) {
          return deny(429, "Too Many Requests", "Too many codes tried. Wait a few minutes, then try again.", { retryAfter: verdict.retryAfterSeconds }, {
            "retry-after": String(verdict.retryAfterSeconds),
          });
        }
      }
      if (MANAGE_PATHS.has(path)) {
        if (user.twoFactor.enabled) {
          const verifiedAt = user.twoFactor.verifiedAt;
          if (!verifiedAt || at.getTime() - verifiedAt.getTime() > MANAGE_WINDOW_MS) {
            return deny(403, "Forbidden", "Enter a code from your authenticator app first, then try again within 10 minutes.", { code: "two_factor_required" });
          }
        } else if (at.getTime() - new Date(found.session.createdAt).getTime() > MANAGE_WINDOW_MS) {
          return deny(403, "Forbidden", "Sign in again, then set up two-step verification within 10 minutes.", { code: "fresh_sign_in_required" });
        }
      }
      return null;
    },

    /**
     * After a successful change: records a correct code on the session that sent it (or on its replacement, when setting
     * up or turning off rotates the session), writes the audit log, and emails the owner about setup, turn-off and new codes.
     */
    async after(req: Request, path: string, res: Response): Promise<void> {
      if (!res.ok || !(VERIFY_PATHS.has(path) || MANAGE_PATHS.has(path))) return;
      const name = sessionCookieName(config);
      const rotated = res.headers
        .getSetCookie()
        .map((c) => c.split(";")[0]!)
        .find((pair) => pair.startsWith(`${name}=`) && pair.length > name.length + 1);
      const found = await auth.api.getSession({ headers: rotated ? new Headers({ cookie: rotated }) : req.headers });
      if (!found) return;
      const at = now();

      // Only the code that confirms a new setup replaces the session; later codes keep it.
      const event: TwoFactorEvent | null =
        path === "/two-factor/disable"
          ? "disable"
          : path === "/two-factor/generate-backup-codes"
            ? "backup_codes"
            : path === "/two-factor/enable"
              ? null // Not on yet: it's on once a code confirms it.
              : rotated
                ? "enable"
                : "verify";
      if (!event) return;
      if (VERIFY_PATHS.has(path)) await db.update(sessions).set({ twoFactorVerifiedAt: at }).where(eq(sessions.id, found.session.id));
      await db.insert(auditLog).values({
        actorId: found.user.id,
        action: `two_factor.${event}`,
        targetType: "user",
        targetId: found.user.id,
        meta: event === "verify" ? { method: path === "/two-factor/verify-backup-code" ? "backup_code" : "totp" } : {},
        createdAt: at,
      });
      if (event === "verify") return;
      try {
        await mailer.send(twoFactorChangeEmail(found.user.email, event, at));
      } catch (err) {
        // The change itself succeeded; a mail outage shouldn't undo or hide it.
        logger.warn("two_factor.notify_failed", { event, err });
      }
    },
  };
}

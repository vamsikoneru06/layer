import { createHash, randomUUID } from "node:crypto";
import { LIMITS } from "@vash/schema";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { toNextJsHandler } from "better-auth/next-js";
import { magicLink } from "better-auth/plugins/magic-link";
import { twoFactor } from "better-auth/plugins/two-factor";
import type { AppConfig } from "../config";
import { authSchema } from "../db/schema";
import type { Db } from "../db/types";
import { readText } from "../http/body";
import { clientIp, rateLimitSubject } from "../http/client-ip";
import { HttpError, problem } from "../http/problem";
import { betterAuthRateLimitStorage, consume } from "../rate-limit/limiter";
import { RATE_LIMITS } from "../rate-limit/rules";
import { authCookieOptions } from "./cookies";
import { magicLinkEmail, type Mailer } from "./mailer";
import { twoFactorGuard } from "./two-factor";

export interface AuthDeps {
  db: Db;
  config: AppConfig;
  mailer: Mailer;
  now: () => Date;
}

const DAY_SECONDS = 60 * 60 * 24;
const AUTH_BODY_LIMIT = 8 * 1024;

/** Where each route takes the caller's post-sign-in redirects from. Better Auth doesn't check them on magic links. */
const REDIRECT_SOURCES: Record<string, "body" | "query"> = {
  "/sign-in/magic-link": "body",
  "/magic-link/verify": "query",
  "/sign-in/social": "body",
};
const REDIRECT_FIELDS = ["callbackURL", "newUserCallbackURL", "errorCallbackURL"] as const;

/**
 * True when `value` (if given) resolves to this app's origin. Better Auth URL-decodes the value again
 * before redirecting, so every decoding of it must stay on-site too ("%2F%2Fevil.example" -> "//evil.example").
 */
export function isSameOriginRedirect(value: unknown, appOrigin: string): boolean {
  if (value === undefined) return true;
  if (typeof value !== "string" || value.length > 2048) return false;
  let current = value;
  for (let i = 0; i < 4; i++) {
    // Browsers treat "\" like "/" and drop tabs and newlines, which can turn a path into another host.
    if ([...current].some((ch) => ch === "\\" || ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f)) return false;
    try {
      if (new URL(current, appOrigin).origin !== appOrigin) return false;
      const decoded = decodeURIComponent(current);
      if (decoded === current) return true;
      current = decoded;
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Better Auth routes that would bypass VASH's own rules: profile writes skip `PATCH /api/me`
 * validation, account deletion skips the audit log and storage-deletion queue, and the rest
 * (passwords, email change, provider tokens, account linking) are not part of the product.
 */
const DISABLED_PATHS = [
  "/update-user",
  "/delete-user",
  "/delete-user/callback",
  "/change-email",
  "/change-password",
  "/set-password",
  "/verify-password",
  "/sign-up/email",
  "/sign-in/email",
  "/request-password-reset",
  "/reset-password",
  "/reset-password/:token",
  "/send-verification-email",
  "/verify-email",
  "/update-session",
  "/get-access-token",
  "/refresh-token",
  "/account-info",
  "/link-social",
  "/unlink-account",
  // Two-factor by email code isn't offered, and the setup key is shown once at setup, never again to a session.
  "/two-factor/send-otp",
  "/two-factor/verify-otp",
  "/two-factor/get-totp-uri",
];

export function createAuth({ db, config, mailer, now }: AuthDeps) {
  const perIp = { window: RATE_LIMITS.magicLinkPerIp.windowSeconds, max: RATE_LIMITS.magicLinkPerIp.max };
  const tooMany = () => new APIError("TOO_MANY_REQUESTS", { message: "Too many sign-in links requested. Try again later." });

  return betterAuth({
    appName: "VASH",
    baseURL: config.appOrigin,
    basePath: "/api/auth",
    secret: config.authSecret,
    trustedOrigins: [config.appOrigin],
    database: drizzleAdapter(db, { provider: "pg", schema: authSchema }),
    emailAndPassword: { enabled: false },
    socialProviders: config.google
      ? { google: { clientId: config.google.clientId, clientSecret: config.google.clientSecret } }
      : {},
    session: { expiresIn: 30 * DAY_SECONDS, updateAge: DAY_SECONDS },
    disabledPaths: DISABLED_PATHS,
    rateLimit: {
      enabled: true,
      window: 60,
      max: 100,
      customRules: { "/sign-in/magic-link": perIp },
      customStorage: betterAuthRateLimitStorage(db, now),
    },
    advanced: {
      ...authCookieOptions(config),
      // Without a trusted proxy the forwarded header is attacker-controlled; our own hook below
      // still limits per client using a shared bucket.
      ipAddress: config.trustProxy ? { ipAddressHeaders: ["x-forwarded-for"] } : { disableIpTracking: true },
    },
    hooks: {
      // Runs before Better Auth stores a verification row, so rejected requests leave nothing behind.
      before: createAuthMiddleware(async (ctx) => {
        const source = REDIRECT_SOURCES[ctx.path];
        if (source) {
          const values = ((source === "query" ? ctx.query : ctx.body) ?? {}) as Record<string, unknown>;
          for (const field of REDIRECT_FIELDS) {
            if (!isSameOriginRedirect(values[field], config.appOrigin)) {
              throw new APIError("FORBIDDEN", { message: `${field} must point to this site.` });
            }
          }
        }
        if (ctx.path !== "/sign-in/magic-link") return;
        const body = (ctx.body ?? {}) as { email?: unknown; name?: unknown };
        if (body.name !== undefined && (typeof body.name !== "string" || body.name.length > LIMITS.nameChars)) {
          throw new APIError("BAD_REQUEST", { message: `name must be at most ${LIMITS.nameChars} characters.` });
        }
        const ip = rateLimitSubject(ctx.request ? clientIp(ctx.request, config.trustProxy) : null);
        if (!(await consume(db, `magic-link:ip:${ip}`, RATE_LIMITS.magicLinkPerIp, now())).allowed) throw tooMany();
        if (typeof body.email === "string") {
          const emailKey = createHash("sha256").update(body.email.trim().toLowerCase()).digest("hex");
          if (!(await consume(db, `magic-link:email:${emailKey}`, RATE_LIMITS.magicLinkPerEmail, now())).allowed) throw tooMany();
        }
      }),
    },
    plugins: [
      magicLink({
        expiresIn: 10 * 60,
        storeToken: "hashed",
        rateLimit: perIp,
        async sendMagicLink({ email, url }) {
          await mailer.send(magicLinkEmail(email, url));
        },
      }),
      // Authenticator-app codes for admins; who may use it and when is enforced by twoFactorGuard (two-factor.ts).
      // Passwordless: VASH accounts have no password, so the plugin's password confirmation can't apply.
      twoFactor({ issuer: "VASH", allowPasswordless: true }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;

/** Better Auth's handler behind the same strict Origin check, a small body cap and VASH's two-factor rules. */
export function createAuthRoute(auth: Auth, { db, config, now }: Pick<AuthDeps, "db" | "config" | "now">) {
  const http = toNextJsHandler(auth);
  const guard = twoFactorGuard({ auth, db, config, now });
  return {
    GET: (req: Request) => http.GET(req),
    async POST(req: Request): Promise<Response> {
      if (req.headers.get("origin") !== config.appOrigin) {
        return problem(403, "Forbidden", "Cross-origin requests are not allowed.", randomUUID());
      }
      let body: string;
      try {
        body = await readText(req, AUTH_BODY_LIMIT);
      } catch (err) {
        if (err instanceof HttpError) return problem(err.status, err.title, err.detail, randomUUID());
        throw err;
      }
      const path = new URL(req.url).pathname.replace(/^\/api\/auth/, "");
      const refused = await guard.before(req, path);
      if (refused) return refused;
      const res = await http.POST(new Request(req.url, { method: "POST", headers: req.headers, body }));
      await guard.after(req, path, res);
      return res;
    },
  };
}

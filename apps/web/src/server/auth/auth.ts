import { createHash, randomUUID } from "node:crypto";
import { LIMITS } from "@layer/schema";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { toNextJsHandler } from "better-auth/next-js";
import { magicLink } from "better-auth/plugins/magic-link";
import type { AppConfig } from "../config";
import { authSchema } from "../db/schema";
import type { Db } from "../db/types";
import { readText } from "../http/body";
import { clientIp } from "../http/client-ip";
import { HttpError, problem } from "../http/problem";
import { betterAuthRateLimitStorage, consume } from "../rate-limit/limiter";
import { RATE_LIMITS } from "../rate-limit/rules";
import { magicLinkEmail, type Mailer } from "./mailer";

export interface AuthDeps {
  db: Db;
  config: AppConfig;
  mailer: Mailer;
  now: () => Date;
}

const DAY_SECONDS = 60 * 60 * 24;
const AUTH_BODY_LIMIT = 8 * 1024;

/**
 * Better Auth routes that would bypass Layer's own rules: profile writes skip `PATCH /api/me`
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
];

export function createAuth({ db, config, mailer, now }: AuthDeps) {
  const perIp = { window: RATE_LIMITS.magicLinkPerIp.windowSeconds, max: RATE_LIMITS.magicLinkPerIp.max };
  const tooMany = () => new APIError("TOO_MANY_REQUESTS", { message: "Too many sign-in links requested. Try again later." });

  return betterAuth({
    appName: "Layer",
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
      useSecureCookies: config.isProduction,
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax", secure: config.isProduction },
      // Without a trusted proxy the forwarded header is attacker-controlled; our own hook below
      // still limits per client using a shared bucket.
      ipAddress: config.trustProxy ? { ipAddressHeaders: ["x-forwarded-for"] } : { disableIpTracking: true },
    },
    hooks: {
      // Runs before Better Auth stores a verification row, so rejected requests leave nothing behind.
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/sign-in/magic-link") return;
        const body = (ctx.body ?? {}) as { email?: unknown; name?: unknown };
        if (body.name !== undefined && (typeof body.name !== "string" || body.name.length > LIMITS.nameChars)) {
          throw new APIError("BAD_REQUEST", { message: `name must be at most ${LIMITS.nameChars} characters.` });
        }
        const ip = (ctx.request && clientIp(ctx.request, config.trustProxy)) ?? "unknown";
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
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;

/** Better Auth's handler behind the same strict Origin check and a small body cap. */
export function createAuthRoute(auth: Auth, config: AppConfig) {
  const http = toNextJsHandler(auth);
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
      return http.POST(new Request(req.url, { method: "POST", headers: req.headers, body }));
    },
  };
}

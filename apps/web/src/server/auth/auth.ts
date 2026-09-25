import { createHash, randomUUID } from "node:crypto";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { toNextJsHandler } from "better-auth/next-js";
import { magicLink } from "better-auth/plugins/magic-link";
import type { AppConfig } from "../config";
import { authSchema } from "../db/schema";
import type { Db } from "../db/types";
import { problem } from "../http/problem";
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

export function createAuth({ db, config, mailer, now }: AuthDeps) {
  const perIp = { window: RATE_LIMITS.magicLinkPerIp.windowSeconds, max: RATE_LIMITS.magicLinkPerIp.max };
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
      // Without a trusted proxy the forwarded header is attacker-controlled; per-email limits still apply.
      ipAddress: config.trustProxy ? { ipAddressHeaders: ["x-forwarded-for"] } : { disableIpTracking: true },
    },
    plugins: [
      magicLink({
        expiresIn: 10 * 60,
        storeToken: "hashed",
        rateLimit: perIp,
        async sendMagicLink({ email, url }) {
          const emailKey = createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
          const verdict = await consume(db, `magic-link:email:${emailKey}`, RATE_LIMITS.magicLinkPerEmail, now());
          if (!verdict.allowed) {
            throw new APIError("TOO_MANY_REQUESTS", { message: "Too many sign-in links for this email. Try again later." });
          }
          await mailer.send(magicLinkEmail(email, url));
        },
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;

/** Better Auth's handler, plus the same strict Origin check every other state-changing route gets. */
export function createAuthRoute(auth: Auth, config: AppConfig) {
  const http = toNextJsHandler(auth);
  return {
    GET: (req: Request) => http.GET(req),
    POST: (req: Request) =>
      req.headers.get("origin") === config.appOrigin
        ? http.POST(req)
        : Promise.resolve(problem(403, "Forbidden", "Cross-origin requests are not allowed.", randomUUID())),
  };
}

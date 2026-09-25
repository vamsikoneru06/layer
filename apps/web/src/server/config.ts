import { z } from "zod";

export interface AppConfig {
  nodeEnv: "development" | "test" | "production";
  isProduction: boolean;
  databaseUrl: string;
  appOrigin: string;
  authSecret: string;
  trustProxy: boolean;
  google: { clientId: string; clientSecret: string } | null;
  mail: { kind: "console" } | { kind: "resend"; apiKey: string; from: string };
}

const optional = z.preprocess((v) => (v === "" ? undefined : v), z.string().trim().min(1).optional());

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, "must be a postgres:// connection string"),
    APP_ORIGIN: z.url().refine((v) => new URL(v).origin === v, "must be a bare origin such as https://example.com"),
    BETTER_AUTH_SECRET: z.string().min(32, "must be at least 32 characters"),
    TRUST_PROXY: z.enum(["true", "false"]).default("false"),
    GOOGLE_CLIENT_ID: optional,
    GOOGLE_CLIENT_SECRET: optional,
    RESEND_API_KEY: optional,
    MAIL_FROM: optional,
  })
  .superRefine((env, ctx) => {
    if (Boolean(env.GOOGLE_CLIENT_ID) !== Boolean(env.GOOGLE_CLIENT_SECRET)) {
      ctx.addIssue({ code: "custom", path: ["GOOGLE_CLIENT_SECRET"], message: "set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET together, or neither" });
    }
    if (env.RESEND_API_KEY && !env.MAIL_FROM) {
      ctx.addIssue({ code: "custom", path: ["MAIL_FROM"], message: "required when RESEND_API_KEY is set" });
    }
    if (env.NODE_ENV === "production") {
      if (!env.RESEND_API_KEY) ctx.addIssue({ code: "custom", path: ["RESEND_API_KEY"], message: "required in production" });
      if (!env.APP_ORIGIN.startsWith("https://")) ctx.addIssue({ code: "custom", path: ["APP_ORIGIN"], message: "must use https in production" });
      if (env.TRUST_PROXY !== "true") {
        ctx.addIssue({ code: "custom", path: ["TRUST_PROXY"], message: "must be true in production, or every client shares one rate-limit bucket" });
      }
    }
  });

export class ConfigError extends Error {
  override name = "ConfigError";
}

/** Validates the environment once. Messages name variables but never echo their values. */
export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`);
    throw new ConfigError(`Invalid environment configuration:\n${lines.join("\n")}`);
  }
  const e = parsed.data;
  return {
    nodeEnv: e.NODE_ENV,
    isProduction: e.NODE_ENV === "production",
    databaseUrl: e.DATABASE_URL,
    appOrigin: e.APP_ORIGIN,
    authSecret: e.BETTER_AUTH_SECRET,
    trustProxy: e.TRUST_PROXY === "true",
    google:
      e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET
        ? { clientId: e.GOOGLE_CLIENT_ID, clientSecret: e.GOOGLE_CLIENT_SECRET }
        : null,
    mail: e.RESEND_API_KEY && e.MAIL_FROM ? { kind: "resend", apiKey: e.RESEND_API_KEY, from: e.MAIL_FROM } : { kind: "console" },
  };
}

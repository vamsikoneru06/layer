import { z } from "zod";

export interface StorageConfig {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  privateBucket: string;
  publicBucket: string;
  publicBaseUrl: string;
}

export interface AppConfig {
  nodeEnv: "development" | "test" | "production";
  isProduction: boolean;
  databaseUrl: string;
  appOrigin: string;
  authSecret: string;
  trustProxy: boolean;
  google: { clientId: string; clientSecret: string } | null;
  mail:
    | { kind: "console" }
    | { kind: "resend"; apiKey: string; from: string }
    | { kind: "gmail"; user: string; appPassword: string; from: string };
  storage: StorageConfig | null;
  cronSecret: string | null;
}

const optional = z.preprocess((v) => (v === "" ? undefined : v), z.string().trim().min(1).optional());
const optionalUrl = z.preprocess((v) => (v === "" ? undefined : v), z.url().optional());
const bucket = z.string().regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/, "must be a lowercase bucket name");
const STORAGE_CONNECTION_VARS = ["STORAGE_ENDPOINT", "STORAGE_REGION", "STORAGE_ACCESS_KEY_ID", "STORAGE_SECRET_ACCESS_KEY", "STORAGE_PUBLIC_BASE_URL"] as const;

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
    // Free: a Google account plus an App Password (myaccount.google.com/apppasswords).
    GMAIL_USER: optional,
    GMAIL_APP_PASSWORD: optional,
    // Supabase Storage (S3 protocol): Project settings → Storage → S3 Connection / S3 Access Keys.
    STORAGE_ENDPOINT: optionalUrl,
    STORAGE_REGION: optional,
    STORAGE_ACCESS_KEY_ID: optional,
    STORAGE_SECRET_ACCESS_KEY: optional,
    STORAGE_PUBLIC_BASE_URL: optionalUrl,
    STORAGE_PRIVATE_BUCKET: bucket.default("vash-private"),
    STORAGE_PUBLIC_BUCKET: bucket.default("vash-public"),
    CRON_SECRET: z.preprocess((v) => (v === "" ? undefined : v), z.string().min(32, "must be at least 32 characters").optional()),
  })
  .superRefine((env, ctx) => {
    if (Boolean(env.GOOGLE_CLIENT_ID) !== Boolean(env.GOOGLE_CLIENT_SECRET)) {
      ctx.addIssue({ code: "custom", path: ["GOOGLE_CLIENT_SECRET"], message: "set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET together, or neither" });
    }
    if (Boolean(env.GMAIL_USER) !== Boolean(env.GMAIL_APP_PASSWORD)) {
      ctx.addIssue({ code: "custom", path: ["GMAIL_APP_PASSWORD"], message: "set GMAIL_USER and GMAIL_APP_PASSWORD together, or neither" });
    }
    if (env.RESEND_API_KEY && !env.MAIL_FROM) {
      ctx.addIssue({ code: "custom", path: ["MAIL_FROM"], message: "required when RESEND_API_KEY is set" });
    }
    const storageSet = STORAGE_CONNECTION_VARS.filter((k) => env[k]);
    if (storageSet.length > 0 && storageSet.length < STORAGE_CONNECTION_VARS.length) {
      for (const k of STORAGE_CONNECTION_VARS) {
        if (!env[k]) ctx.addIssue({ code: "custom", path: [k], message: "set all STORAGE_* connection variables together, or none" });
      }
    }
    if (env.NODE_ENV === "production") {
      // Without a bucket, photos are kept in the database (storage/database.ts), so STORAGE_* is optional.
      for (const k of ["STORAGE_ENDPOINT", "STORAGE_PUBLIC_BASE_URL"] as const) {
        if (env[k] && !env[k].startsWith("https://")) ctx.addIssue({ code: "custom", path: [k], message: "must use https in production" });
      }
      if (!env.CRON_SECRET) ctx.addIssue({ code: "custom", path: ["CRON_SECRET"], message: "required in production (scheduled cleanup)" });
      if (!env.RESEND_API_KEY && !env.GMAIL_USER) {
        ctx.addIssue({ code: "custom", path: ["RESEND_API_KEY"], message: "required in production unless GMAIL_USER is set" });
      }
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
    mail:
      e.RESEND_API_KEY && e.MAIL_FROM
        ? { kind: "resend", apiKey: e.RESEND_API_KEY, from: e.MAIL_FROM }
        : e.GMAIL_USER && e.GMAIL_APP_PASSWORD
          ? { kind: "gmail", user: e.GMAIL_USER, appPassword: e.GMAIL_APP_PASSWORD, from: e.MAIL_FROM ?? `VASH <${e.GMAIL_USER}>` }
          : { kind: "console" },
    storage:
      e.STORAGE_ENDPOINT && e.STORAGE_REGION && e.STORAGE_ACCESS_KEY_ID && e.STORAGE_SECRET_ACCESS_KEY && e.STORAGE_PUBLIC_BASE_URL
        ? {
            endpoint: e.STORAGE_ENDPOINT,
            region: e.STORAGE_REGION,
            accessKeyId: e.STORAGE_ACCESS_KEY_ID,
            secretAccessKey: e.STORAGE_SECRET_ACCESS_KEY,
            privateBucket: e.STORAGE_PRIVATE_BUCKET,
            publicBucket: e.STORAGE_PUBLIC_BUCKET,
            publicBaseUrl: e.STORAGE_PUBLIC_BASE_URL.replace(/\/+$/, ""),
          }
        : null,
    cronSecret: e.CRON_SECRET ?? null,
  };
}

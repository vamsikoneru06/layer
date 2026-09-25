# Phase 0 Backend Foundation — Implementation Plan (Plan 1 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up `apps/web` as a tested, secure API foundation: config, database schema and migrations, Postgres-backed rate limiter, HTTP kernel, Better Auth magic-link sign-in, security headers, health, and the first owner-scoped resources (folders, designs, me). CI and security workflows run all of it.

**Architecture:** Next.js 16 route handlers are thin: each `route.ts` file forwards to a handler built by a factory (`folderHandlers(deps)`) from a lazily created composition root. Handlers call services, which hold the business rules. Services call repositories, where every query is scoped to the owner. Dependencies (db, config, logger, clock, authenticator) are passed in explicitly, so the tests run the real handlers against real Postgres (PGlite), with no mocks and no Next.js runtime.

**Tech Stack:** Next.js 16.3 · TypeScript 6 · Drizzle ORM 0.45 + drizzle-kit 0.31 · PGlite 0.5 (tests) / node-postgres (runtime) · Better Auth 1.7.5 (magic-link plugin, Drizzle adapter) · Zod 4 (request DTOs only) · Vitest 5.

**Spec:** `docs/superpowers/specs/2026-09-24-layer-design.md` — §9 (Backend), §5 (server layering), §11.3 (testing). Read §9 before starting.

**Plan series:** Plan 1 (this one) is the foundation. Plan 2 covers assets and uploads (presign, file-signature sniffing, resolve), templates and gallery (search, use, preflight, publish, versions, reports), share links and remix, `GET /api/users/:handle`, admin moderation, and cron cleanup. Plan 3 covers `deploy.yml`, provisioning Vercel, Neon and R2, and a production smoke test.

## Global Constraints

- Node `>=24` (`.nvmrc` = 24). pnpm `12.6.0` via corepack. `pnpm` is not on PATH on the dev machine, so every command below is written as `corepack pnpm …`.
- Errors are RFC 9457 `application/problem+json` and always carry a `requestId`.
- "Every query owner-scoped in repositories; foreign resources return **404** (no existence leaks)."
- "`SameSite=Lax` cookies + strict `Origin` check on every state-changing request."
- Sessions: "Google OAuth + single-use 10-minute magic links; DB sessions; `HttpOnly; Secure; SameSite=Lax` cookies; 30-day rolling expiry; auth-route rate limits."
- "Lists use keyset (cursor) pagination, max 50 per page."
- Rate limits (§9.6): magic-link send 5/hour per email and 20/hour per IP; design save (PUT) 120/minute per user; the other limits are defined now and used in Plan 2.
- "Structured JSON logs with `requestId` and no PII." No secrets or tokens in logs.
- "Env validated at boot (fail fast); `server-only` imports; `.env.example` only."
- Zod is for request DTOs only. Documents are validated by `@layer/schema`'s hand-written `parseDoc`.
- Built from scratch, with no library: the rate limiter.
- No `dangerouslySetInnerHTML` (the ESLint rule already exists).
- Commit style: Conventional Commits (`feat(web): …`, `test(web): …`, `ci: …`), matching `git log`.

## Review Focus

Five inputs the spec implies but doesn't spell out. Each one gets a test in the task that owns the code:

1. **Non-UUID ids in paths** (`/api/designs/abc`, `/api/folders/1'`) should return 404, not a 500 from Postgres rejecting the uuid cast. Covered in Task 4 (`parseId`), Task 7 and Task 8.
2. **Hostile request bodies** (wrong content type, oversized body, invalid JSON or UTF-8, a JSON array instead of an object) should return 415, 413 or 400, never 500. Covered in Task 4.
3. **Two tabs autosaving the same version at once**: exactly one save succeeds and the other gets 409 with `currentVersion`. Covered in Task 8.
4. **Mass assignment** (`role`, `ownerId`, `version` or `id` in a body): strict schemas reject it with 400 and nothing changes. Covered in Task 7, Task 8 and Task 9.
5. **Database or internal failure**: `/api/health` returns 503, other endpoints return a generic 500 problem, and no SQL, parameters or stack trace reaches the client or the logs. Covered in Task 4 and Task 6.

---

## File Structure

```
apps/web/
├─ package.json                      (modify: lint script)
├─ tsconfig.json  next.config.ts  vitest.config.ts  drizzle.config.ts  .env.example
├─ drizzle/                          generated SQL migrations (+ one custom migration)
├─ scripts/migrate.ts                applies migrations with node-postgres (CI + deploy)
├─ src/
│  ├─ instrumentation.ts             boot-time config validation (fail fast)
│  ├─ proxy.ts                       per-request CSP nonce + security headers (Next 16 "proxy")
│  ├─ app/layout.tsx  app/page.tsx   minimal shell (P1 replaces)
│  ├─ app/api/**/route.ts            one-line forwards to handlers from the composition root
│  └─ server/
│     ├─ config.ts                   Zod env schema → AppConfig
│     ├─ deps.ts                     Deps + CurrentUser types
│     ├─ context.ts                  composition root (server-only), lazy
│     ├─ logging.ts                  JSON logger with redaction
│     ├─ db/{schema,types,client,errors}.ts
│     ├─ rate-limit/{limiter,rules}.ts
│     ├─ http/{types,problem,ids,body,cursor,client-ip,endpoint}.ts
│     ├─ security/headers.ts
│     ├─ auth/{auth,mailer,current-user}.ts
│     ├─ health/handlers.ts
│     ├─ assets/repository.ts        (Plan 1: only "which asset refs can this user use?")
│     ├─ folders/{repository,handlers}.ts
│     ├─ designs/{repository,service,handlers}.ts
│     └─ me/{service,handlers}.ts
└─ tests/support/                    test DB, factories, invoke helper, capture mailer/logger
```

Tests sit next to the code as `*.test.ts`, matching `packages/schema`. The folders resource has no service file because it has no business rules beyond owner scoping. Adding a pass-through layer would only be ceremony.

---

### Task 1: Web app scaffold and validated config

**Files:**
- Create: `apps/web/tsconfig.json`, `apps/web/next.config.ts`, `apps/web/vitest.config.ts`, `apps/web/.env.example`
- Create: `apps/web/src/app/layout.tsx`, `apps/web/src/app/page.tsx`, `apps/web/src/instrumentation.ts`
- Create: `apps/web/src/server/config.ts`, `apps/web/src/server/config.test.ts`
- Create: `apps/web/tests/support/empty.ts`
- Modify: `apps/web/package.json` (lint script), `eslint.config.mjs` (tests/support override), `.gitignore` (next-env.d.ts)
- Commit alongside: the already-modified `pnpm-lock.yaml` and `pnpm-workspace.yaml`

**Interfaces:**
- Produces: `loadConfig(env: Record<string, string | undefined>): AppConfig`, `ConfigError`, and
  ```ts
  interface AppConfig {
    nodeEnv: "development" | "test" | "production"; isProduction: boolean;
    databaseUrl: string; appOrigin: string; authSecret: string; trustProxy: boolean;
    google: { clientId: string; clientSecret: string } | null;
    mail: { kind: "console" } | { kind: "resend"; apiKey: string; from: string };
  }
  ```

- [ ] **Step 1: Add the tooling files**

`apps/web/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "types": ["node"],
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] },
    "incremental": true
  },
  "include": ["next-env.d.ts", "src", "scripts", "tests", "*.ts", ".next/types/**/*.ts"],
  "exclude": ["node_modules", ".next"]
}
```

`apps/web/next.config.ts`:
```ts
import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ["@layer/schema"],
};

export default config;
```

`apps/web/vitest.config.ts` (`server-only` throws outside React Server Components, so tests alias it to an empty module):
```ts
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/support/empty.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
```

`apps/web/tests/support/empty.ts`:
```ts
export {};
```

`apps/web/package.json`: change `"lint": "eslint src scripts"` to `"lint": "eslint ."`. The root config already ignores `.next`, `drizzle` and `node_modules`.

`eslint.config.mjs`: widen the test override so that helpers can return `any` bodies:
```js
  {
    files: ["**/*.test.ts", "**/tests/support/**/*.ts"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
```

`.gitignore`: append `next-env.d.ts`.

- [ ] **Step 2: Write the failing config tests**

`apps/web/src/server/config.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./config";

const base = {
  DATABASE_URL: "postgres://layer:layer@localhost:5432/layer",
  APP_ORIGIN: "http://localhost:3000",
  BETTER_AUTH_SECRET: "s".repeat(32),
};

function errorOf(env: Record<string, string | undefined>): string {
  try {
    loadConfig(env);
  } catch (err) {
    expect(err).toBeInstanceOf(ConfigError);
    return String(err);
  }
  throw new Error("expected loadConfig to throw");
}

describe("loadConfig", () => {
  it("parses a minimal development environment", () => {
    expect(loadConfig(base)).toMatchObject({
      nodeEnv: "development",
      isProduction: false,
      trustProxy: false,
      google: null,
      mail: { kind: "console" },
    });
  });

  it("names the bad variable without echoing its value", () => {
    const secret = "tooshort-but-still-secret";
    const message = errorOf({ ...base, BETTER_AUTH_SECRET: secret });
    expect(message).toContain("BETTER_AUTH_SECRET");
    expect(message).not.toContain(secret);
  });

  it("requires APP_ORIGIN to be a bare origin", () => {
    expect(errorOf({ ...base, APP_ORIGIN: "http://localhost:3000/app" })).toContain("APP_ORIGIN");
  });

  it("treats empty optional values as unset", () => {
    expect(loadConfig({ ...base, GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "", RESEND_API_KEY: "" }).google).toBeNull();
  });

  it("requires both Google credentials or neither", () => {
    expect(errorOf({ ...base, GOOGLE_CLIENT_ID: "id" })).toContain("GOOGLE_CLIENT_SECRET");
  });

  it("requires https and a real mailer in production", () => {
    const message = errorOf({ ...base, NODE_ENV: "production" });
    expect(message).toContain("RESEND_API_KEY");
    expect(message).toContain("APP_ORIGIN");
  });

  it("enables Resend when a key and sender are present", () => {
    expect(loadConfig({ ...base, RESEND_API_KEY: "re_x", MAIL_FROM: "Layer <hi@layer.test>" }).mail).toEqual({
      kind: "resend",
      apiKey: "re_x",
      from: "Layer <hi@layer.test>",
    });
  });

  it("reads TRUST_PROXY", () => {
    expect(loadConfig({ ...base, TRUST_PROXY: "true" }).trustProxy).toBe(true);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `corepack pnpm --filter @layer/web exec vitest run src/server/config.test.ts`
Expected: FAIL with "Failed to resolve import ./config".

- [ ] **Step 4: Implement config**

`apps/web/src/server/config.ts`:
```ts
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
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `corepack pnpm --filter @layer/web exec vitest run src/server/config.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 6: Add the app shell, boot-time validation and `.env.example`**

`apps/web/src/instrumentation.ts`:
```ts
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { loadConfig } = await import("./server/config");
    loadConfig(process.env);
  }
}
```

`apps/web/src/app/layout.tsx`:
```tsx
import type { ReactNode } from "react";

export const metadata = { title: "Layer" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

`apps/web/src/app/page.tsx`:
```tsx
export default function Home() {
  return (
    <main>
      <h1>Layer</h1>
      <p>The editor arrives in Phase 1.</p>
    </main>
  );
}
```

`apps/web/.env.example`:
```bash
# Postgres connection string (Neon in production).
DATABASE_URL=postgres://layer:layer@localhost:5432/layer
# Public origin of the app, no trailing slash.
APP_ORIGIN=http://localhost:3000
# 32+ random characters: openssl rand -base64 32
BETTER_AUTH_SECRET=
# "true" only behind a proxy that overwrites X-Forwarded-For (Vercel).
TRUST_PROXY=false
# Optional Google OAuth — set both or neither.
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
# Email via Resend. Required in production; development logs sign-in links to the console.
RESEND_API_KEY=
MAIL_FROM=
```

- [ ] **Step 7: Verify typecheck, lint and build**

Run: `corepack pnpm --filter @layer/web typecheck && corepack pnpm --filter @layer/web lint && corepack pnpm --filter @layer/web build`
Expected: all three succeed. The build prints the `/` route and creates `next-env.d.ts`. If Next rewrites `tsconfig.json` (for example, adding `allowJs` or changing `jsx`), keep its edits.

- [ ] **Step 8: Commit**

```bash
git add apps/web eslint.config.mjs .gitignore pnpm-lock.yaml pnpm-workspace.yaml
git commit -m "feat(web): scaffold Next.js 16 app with validated environment config"
```

---

### Task 2: Database schema, migrations and the PGlite test harness

**Files:**
- Create: `apps/web/src/server/db/schema.ts`, `apps/web/src/server/db/types.ts`, `apps/web/src/server/db/client.ts`
- Create: `apps/web/drizzle.config.ts`, `apps/web/scripts/migrate.ts`
- Generate: `apps/web/drizzle/0000_init.sql` (+ `meta/`), `apps/web/drizzle/0001_audit_log_append_only.sql` (custom)
- Create: `apps/web/tests/support/db.ts`, `apps/web/tests/support/factories.ts`
- Test: `apps/web/src/server/db/schema.test.ts`

**Interfaces:**
- Produces: the Drizzle tables `user, session, account, verification, folders, assets, templates, templateVersions, templateUses, designs, reports, shareLinks, auditLog, rateLimits, storageDeletions`; `authSchema = { user, session, account, verification }`; `type Db`; `createDb(url): { db: Db; pool: Pool }`
- Produces (tests): `createTestDb(): Promise<TestDb>` where `TestDb = { db: Db; close(): Promise<void> }`; `dbErrorMessage(p: Promise<unknown>): Promise<string>`; `createUser(db, overrides?)`, `createFolder(db, ownerId, name?)`, `createAsset(db, overrides)`

- [ ] **Step 1: Write the schema**

The Better Auth tables mirror the library's own field list (confirmed from `getAuthTables` in better-auth 1.7.5: `user`, `session`, `account`, `verification`). Property names must stay Better Auth's field names. Column names are snake_case. We supply our own rate-limit store (Task 3), so Better Auth's `rateLimit` table is not needed.

`apps/web/src/server/db/schema.ts`:
```ts
import { sql } from "drizzle-orm";
import { boolean, check, date, index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import type { Doc } from "@layer/schema";

/** Millisecond precision so keyset cursors round-trip through JavaScript Dates exactly. */
const ts = (name: string) => timestamp(name, { withTimezone: true, precision: 3 });
const createdAt = () => ts("created_at").notNull().defaultNow();
const updatedAt = () => ts("updated_at").notNull().defaultNow();
const emptyTextArray = sql`'{}'::text[]`;

// ── Better Auth core ─────────────────────────────────────────────────────────
export const user = pgTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    // Layer extensions. Deliberately NOT declared to Better Auth, so sign-up bodies can never set them.
    handle: text("handle").unique(),
    role: text("role", { enum: ["user", "admin"] }).notNull().default("user"),
    interests: text("interests").array().notNull().default(emptyTextArray),
    onboardedAt: ts("onboarded_at"),
  },
  (t) => [check("user_role_check", sql`${t.role} in ('user', 'admin')`)],
);

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: ts("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("session_user_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: ts("access_token_expires_at"),
    refreshTokenExpiresAt: ts("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("account_user_idx").on(t.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: ts("expires_at").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

export const authSchema = { user, session, account, verification };

// ── Layer domain ─────────────────────────────────────────────────────────────
export const folders = pgTable(
  "folders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("folders_owner_idx").on(t.ownerId, t.createdAt, t.id)],
);

export const assets = pgTable(
  "assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** null = system asset (seed stickers, seed template photos). */
    ownerId: text("owner_id").references(() => user.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["photo", "thumbnail", "sticker"] }).notNull(),
    visibility: text("visibility", { enum: ["private", "public"] }).notNull().default("private"),
    status: text("status", { enum: ["pending", "ready"] }).notNull().default("pending"),
    storageKey: text("storage_key").notNull().unique(),
    mime: text("mime", { enum: ["image/jpeg", "image/png", "image/webp", "image/svg+xml"] }).notNull(),
    bytes: integer("bytes").notNull(),
    width: integer("width"),
    height: integer("height"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("assets_owner_idx").on(t.ownerId, t.createdAt, t.id),
    index("assets_pending_idx").on(t.status, t.createdAt),
    check("assets_kind_check", sql`${t.kind} in ('photo', 'thumbnail', 'sticker')`),
    check("assets_visibility_check", sql`${t.visibility} in ('private', 'public')`),
    check("assets_status_check", sql`${t.status} in ('pending', 'ready')`),
    check("assets_mime_check", sql`${t.mime} in ('image/jpeg', 'image/png', 'image/webp', 'image/svg+xml')`),
    check("assets_bytes_check", sql`${t.bytes} > 0`),
  ],
);

export const templates = pgTable(
  "templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** null = seed template. */
    authorId: text("author_id").references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    category: text("category").notNull(),
    tags: text("tags").array().notNull().default(emptyTextArray),
    format: text("format").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    status: text("status", { enum: ["published", "hidden"] }).notNull().default("published"),
    featured: boolean("featured").notNull().default(false),
    currentVersion: integer("current_version").notNull().default(1),
    usesCount: integer("uses_count").notNull().default(0),
    /** title + tags, written by the service; the only full-text-indexed column (array_to_string isn't immutable). */
    searchText: text("search_text").notNull().default(""),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("templates_search_idx").using("gin", sql`to_tsvector('simple', ${t.searchText})`),
    index("templates_gallery_idx").on(t.status, t.createdAt, t.id),
    index("templates_author_idx").on(t.authorId),
    check("templates_status_check", sql`${t.status} in ('published', 'hidden')`),
  ],
);

export const templateVersions = pgTable(
  "template_versions",
  {
    templateId: uuid("template_id").notNull().references(() => templates.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    doc: jsonb("doc").$type<Doc>().notNull(),
    thumbnailAssetId: uuid("thumbnail_asset_id").references(() => assets.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.templateId, t.version] })],
);

export const templateUses = pgTable(
  "template_uses",
  {
    templateId: uuid("template_id").notNull().references(() => templates.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    day: date("day", { mode: "string" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.templateId, t.userId, t.day] })],
);

export const designs = pgTable(
  "designs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    folderId: uuid("folder_id").references(() => folders.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    doc: jsonb("doc").$type<Doc>().notNull(),
    version: integer("version").notNull().default(1),
    sourceTemplateId: uuid("source_template_id").references(() => templates.id, { onDelete: "set null" }),
    sourceTemplateVersion: integer("source_template_version"),
    thumbnailAssetId: uuid("thumbnail_asset_id").references(() => assets.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("designs_owner_idx").on(t.ownerId, t.updatedAt, t.id)],
);

export const reports = pgTable(
  "reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    templateId: uuid("template_id").notNull().references(() => templates.id, { onDelete: "cascade" }),
    reporterId: text("reporter_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    reason: text("reason", { enum: ["spam", "inappropriate", "copyright", "privacy", "other"] }).notNull(),
    note: text("note").notNull().default(""),
    status: text("status", { enum: ["open", "actioned", "dismissed"] }).notNull().default("open"),
    resolvedBy: text("resolved_by").references(() => user.id, { onDelete: "set null" }),
    resolvedAt: ts("resolved_at"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("reports_template_reporter_unique").on(t.templateId, t.reporterId),
    index("reports_queue_idx").on(t.status, t.createdAt, t.id),
    check("reports_reason_check", sql`${t.reason} in ('spam', 'inappropriate', 'copyright', 'privacy', 'other')`),
    check("reports_status_check", sql`${t.status} in ('open', 'actioned', 'dismissed')`),
  ],
);

export const shareLinks = pgTable(
  "share_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    designId: uuid("design_id").notNull().references(() => designs.id, { onDelete: "cascade" }),
    /** SHA-256 of the 128-bit token; the token itself is never stored. */
    tokenHash: text("token_hash").notNull().unique(),
    createdBy: text("created_by").notNull().references(() => user.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    revokedAt: ts("revoked_at"),
  },
  (t) => [index("share_links_design_idx").on(t.designId)],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** No foreign key: entries must outlive the accounts they describe. */
    actorId: text("actor_id").notNull(),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("audit_log_created_idx").on(t.createdAt)],
);

export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").notNull(),
    windowStart: ts("window_start").notNull(),
    count: integer("count").notNull(),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] }), index("rate_limits_window_idx").on(t.windowStart)],
);

export const storageDeletions = pgTable(
  "storage_deletions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bucket: text("bucket", { enum: ["private", "public"] }).notNull(),
    storageKey: text("storage_key").notNull(),
    attempts: integer("attempts").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [check("storage_deletions_bucket_check", sql`${t.bucket} in ('private', 'public')`)],
);
```

`apps/web/src/server/db/types.ts`:
```ts
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "./schema";

/** Any Drizzle Postgres database or transaction (node-postgres at runtime, PGlite in tests). */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
```

`apps/web/src/server/db/client.ts`:
```ts
import "server-only";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
import type { Db } from "./types";

export function createDb(databaseUrl: string): { db: Db; pool: Pool } {
  const pool = new Pool({ connectionString: databaseUrl, max: 5, idleTimeoutMillis: 10_000 });
  return { db: drizzle(pool, { schema }), pool };
}
```
If `tsc` refuses to assign `NodePgDatabase` or `PgliteDatabase` to `Db`, cast with `as unknown as Db` here and in `tests/support/db.ts`, and nowhere else.

`apps/web/drizzle.config.ts`:
```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://localhost/unused" },
  strict: true,
  verbose: true,
});
```

- [ ] **Step 2: Generate the migrations**

Run: `corepack pnpm --filter @layer/web exec drizzle-kit generate --name init`
Expected: `apps/web/drizzle/0000_init.sql` and `drizzle/meta/` are created. Read the SQL and confirm it has all 15 tables, the GIN index, and the check constraints.

Run: `corepack pnpm --filter @layer/web exec drizzle-kit generate --custom --name audit_log_append_only`
Then replace the generated empty file `apps/web/drizzle/0001_audit_log_append_only.sql` with:
```sql
CREATE FUNCTION audit_log_reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER audit_log_append_only
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_reject_mutation();
```

`apps/web/scripts/migrate.ts`:
```ts
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const pool = new Pool({ connectionString: url, max: 1 });
try {
  await migrate(drizzle(pool), { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });
  console.log("migrations applied");
} finally {
  await pool.end();
}
```

- [ ] **Step 3: Add the test harness and factories**

`apps/web/tests/support/db.ts`:
```ts
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/server/db/schema";
import type { Db } from "@/server/db/types";

export interface TestDb {
  db: Db;
  close(): Promise<void>;
}

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

/** A fresh in-memory Postgres with every migration applied. One per test file. */
export async function createTestDb(): Promise<TestDb> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return { db, close: () => client.close() };
}

/** Drizzle wraps driver errors ("Failed query: …"); return the database's own message. */
export async function dbErrorMessage(query: Promise<unknown>): Promise<string> {
  try {
    await query;
  } catch (err) {
    const cause = (err as { cause?: unknown }).cause;
    return cause instanceof Error ? cause.message : String(err);
  }
  throw new Error("expected the query to fail");
}
```

`apps/web/tests/support/factories.ts`:
```ts
import { randomUUID } from "node:crypto";
import { assets, folders, user } from "@/server/db/schema";
import type { Db } from "@/server/db/types";

export async function createUser(db: Db, overrides: Partial<typeof user.$inferInsert> = {}) {
  const id = overrides.id ?? `u_${randomUUID()}`;
  const [row] = await db
    .insert(user)
    .values({ id, name: "Test User", email: `${id}@example.test`, emailVerified: true, ...overrides })
    .returning();
  if (!row) throw new Error("user insert returned nothing");
  return row;
}

export async function createFolder(db: Db, ownerId: string, name = "Birthdays") {
  const [row] = await db.insert(folders).values({ ownerId, name }).returning();
  if (!row) throw new Error("folder insert returned nothing");
  return row;
}

export async function createAsset(db: Db, overrides: Partial<typeof assets.$inferInsert> & { ownerId: string | null }) {
  const id = overrides.id ?? randomUUID();
  const [row] = await db
    .insert(assets)
    .values({
      id,
      kind: "photo",
      visibility: "private",
      status: "ready",
      storageKey: `u/${overrides.ownerId ?? "system"}/${id}`,
      mime: "image/jpeg",
      bytes: 1_000,
      width: 1200,
      height: 900,
      ...overrides,
    })
    .returning();
  if (!row) throw new Error("asset insert returned nothing");
  return row;
}
```

- [ ] **Step 4: Write the schema tests**

`apps/web/src/server/db/schema.test.ts`:
```ts
import { eq, sql } from "drizzle-orm";
import { createEmptyDoc } from "@layer/schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, dbErrorMessage, type TestDb } from "../../../tests/support/db";
import { createFolder, createUser } from "../../../tests/support/factories";
import { auditLog, designs, folders, reports, templates, user } from "./schema";

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(() => t.close());

describe("database schema", () => {
  it("creates every table", async () => {
    const result = (await t.db.execute(
      sql`select table_name from information_schema.tables where table_schema = 'public' order by table_name`,
    )) as unknown as { rows: { table_name: string }[] };
    expect(result.rows.map((r) => r.table_name)).toEqual(
      expect.arrayContaining([
        "account", "assets", "audit_log", "designs", "folders", "rate_limits", "reports", "session",
        "share_links", "storage_deletions", "template_uses", "template_versions", "templates", "user", "verification",
      ]),
    );
  });

  it("cascades a user's rows when the user is deleted", async () => {
    const owner = await createUser(t.db);
    const folder = await createFolder(t.db, owner.id);
    await t.db.insert(designs).values({
      ownerId: owner.id,
      folderId: folder.id,
      title: "Card",
      doc: createEmptyDoc({ id: "d1", kind: "design", title: "Card", format: "ig-post" }),
    });
    await t.db.delete(user).where(eq(user.id, owner.id));
    expect(await t.db.select().from(folders).where(eq(folders.ownerId, owner.id))).toEqual([]);
    expect(await t.db.select().from(designs).where(eq(designs.ownerId, owner.id))).toEqual([]);
  });

  it("keeps the audit log append-only", async () => {
    await t.db.insert(auditLog).values({ actorId: "u1", action: "test", targetType: "user", targetId: "u1" });
    expect(await dbErrorMessage(t.db.update(auditLog).set({ action: "tampered" }))).toMatch(/append-only/);
    expect(await dbErrorMessage(t.db.delete(auditLog))).toMatch(/append-only/);
  });

  it("rejects roles outside user/admin at the database level", async () => {
    const u = await createUser(t.db);
    expect(await dbErrorMessage(t.db.execute(sql`update "user" set role = 'root' where id = ${u.id}`))).toMatch(/user_role_check/);
  });

  it("allows one report per reporter per template", async () => {
    const reporter = await createUser(t.db);
    const [tpl] = await t.db
      .insert(templates)
      .values({ title: "T", category: "birthday", format: "ig-post", width: 1080, height: 1080 })
      .returning();
    await t.db.insert(reports).values({ templateId: tpl!.id, reporterId: reporter.id, reason: "spam" });
    expect(
      await dbErrorMessage(t.db.insert(reports).values({ templateId: tpl!.id, reporterId: reporter.id, reason: "other" })),
    ).toMatch(/reports_template_reporter_unique/);
  });
});
```

- [ ] **Step 5: Run the tests**

Run: `corepack pnpm --filter @layer/web exec vitest run src/server/db/schema.test.ts`
Expected: PASS (5 tests). If `drizzle-kit` quoted the GIN expression badly, or PGlite rejects it, fix the index definition. Don't drop it.

- [ ] **Step 6: Typecheck, lint, commit**

Run: `corepack pnpm --filter @layer/web typecheck && corepack pnpm --filter @layer/web lint`
```bash
git add apps/web
git commit -m "feat(web): database schema, migrations, append-only audit log, PGlite test harness"
```

---

### Task 3: Postgres fixed-window rate limiter and client IP

**Files:**
- Create: `apps/web/src/server/rate-limit/limiter.ts`, `apps/web/src/server/rate-limit/rules.ts`, `apps/web/src/server/http/client-ip.ts`
- Test: `apps/web/src/server/rate-limit/limiter.test.ts`, `apps/web/src/server/http/client-ip.test.ts`

**Interfaces:**
- Consumes: `rateLimits` table, `Db`, `createTestDb`
- Produces:
  ```ts
  interface RateLimitRule { windowSeconds: number; max: number }
  interface ConsumeResult { allowed: boolean; remaining: number; retryAfterSeconds: number }
  consume(db: Db, key: string, rule: RateLimitRule, now: Date): Promise<ConsumeResult>
  betterAuthRateLimitStorage(db: Db, now: () => Date): { consume(key: string, rule: { window: number; max: number }): Promise<{ allowed: boolean; retryAfter: number | null }> }
  RATE_LIMITS: Record<"magicLinkPerEmail" | "magicLinkPerIp" | "uploadUrl" | "designSave" | "shareCreate" | "sharedView" | "publish" | "report" | "publicRead", RateLimitRule>
  clientIp(req: Request, trustProxy: boolean): string | null
  ```

- [ ] **Step 1: Write the failing tests**

`apps/web/src/server/rate-limit/limiter.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../../tests/support/db";
import { betterAuthRateLimitStorage, consume } from "./limiter";

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(() => t.close());

const rule = { windowSeconds: 60, max: 3 };
const at = (iso: string) => new Date(iso);

describe("consume (fixed window)", () => {
  it("allows up to max requests in a window, then denies", async () => {
    const now = at("2026-09-25T10:00:10.000Z");
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await consume(t.db, "k:basic", rule, now));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results.map((r) => r.remaining)).toEqual([2, 1, 0, 0]);
  });

  it("reports seconds until the window ends", async () => {
    const r = await consume(t.db, "k:retry", { windowSeconds: 60, max: 0 }, at("2026-09-25T10:00:10.000Z"));
    expect(r.allowed).toBe(false);
    expect(r.retryAfterSeconds).toBe(50);
  });

  it("starts a fresh count in the next window", async () => {
    for (let i = 0; i < 3; i++) await consume(t.db, "k:roll", rule, at("2026-09-25T10:00:59.000Z"));
    expect((await consume(t.db, "k:roll", rule, at("2026-09-25T10:00:59.500Z"))).allowed).toBe(false);
    expect((await consume(t.db, "k:roll", rule, at("2026-09-25T10:01:00.000Z"))).allowed).toBe(true);
  });

  it("keeps keys independent", async () => {
    const now = at("2026-09-25T11:00:00.000Z");
    for (let i = 0; i < 3; i++) await consume(t.db, "k:a", rule, now);
    expect((await consume(t.db, "k:b", rule, now)).allowed).toBe(true);
  });

  it("counts concurrent requests exactly", async () => {
    const now = at("2026-09-25T12:00:00.000Z");
    const results = await Promise.all(Array.from({ length: 10 }, () => consume(t.db, "k:burst", { windowSeconds: 60, max: 5 }, now)));
    expect(results.filter((r) => r.allowed)).toHaveLength(5);
  });
});

describe("betterAuthRateLimitStorage", () => {
  it("adapts consume to Better Auth's contract under an auth: prefix", async () => {
    const now = at("2026-09-25T13:00:00.000Z");
    const storage = betterAuthRateLimitStorage(t.db, () => now);
    expect(await storage.consume("1.2.3.4/sign-in", { window: 10, max: 1 })).toEqual({ allowed: true, retryAfter: null });
    expect(await storage.consume("1.2.3.4/sign-in", { window: 10, max: 1 })).toEqual({ allowed: false, retryAfter: 10 });
    expect((await consume(t.db, "auth:1.2.3.4/sign-in", { windowSeconds: 10, max: 99 }, now)).remaining).toBe(96);
  });
});
```

`apps/web/src/server/http/client-ip.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { clientIp } from "./client-ip";

const req = (xff?: string) => new Request("http://localhost/", { headers: xff === undefined ? {} : { "x-forwarded-for": xff } });

describe("clientIp", () => {
  it("ignores forwarding headers unless the proxy is trusted", () => {
    expect(clientIp(req("203.0.113.7"), false)).toBeNull();
  });
  it("reads a single forwarded IPv4 or IPv6 address behind a trusted proxy", () => {
    expect(clientIp(req(" 203.0.113.7 "), true)).toBe("203.0.113.7");
    expect(clientIp(req("2001:db8::1"), true)).toBe("2001:db8::1");
  });
  it("rejects chains and garbage (matches Better Auth, so both key the same client)", () => {
    expect(clientIp(req("203.0.113.7, 10.0.0.1"), true)).toBeNull();
    expect(clientIp(req("not-an-ip"), true)).toBeNull();
    expect(clientIp(req(), true)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm --filter @layer/web exec vitest run src/server/rate-limit src/server/http/client-ip.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`apps/web/src/server/rate-limit/limiter.ts`:
```ts
import { sql } from "drizzle-orm";
import { rateLimits } from "../db/schema";
import type { Db } from "../db/types";

export interface RateLimitRule {
  windowSeconds: number;
  max: number;
}

export interface ConsumeResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * Fixed-window counter. One atomic upsert per call, so concurrent requests can't both slip under
 * the limit: Postgres serialises the increments on the (key, window_start) row.
 */
export async function consume(db: Db, key: string, rule: RateLimitRule, now: Date): Promise<ConsumeResult> {
  const windowMs = rule.windowSeconds * 1000;
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  const [row] = await db
    .insert(rateLimits)
    .values({ key, windowStart, count: 1 })
    .onConflictDoUpdate({ target: [rateLimits.key, rateLimits.windowStart], set: { count: sql`${rateLimits.count} + 1` } })
    .returning({ count: rateLimits.count });
  const count = row?.count ?? Number.POSITIVE_INFINITY;
  return {
    allowed: count <= rule.max,
    remaining: Math.max(0, rule.max - count),
    retryAfterSeconds: Math.max(1, Math.ceil((windowStart.getTime() + windowMs - now.getTime()) / 1000)),
  };
}

/** Better Auth ≥1.7 `rateLimit.customStorage`: one limiter and one table for the whole app. */
export function betterAuthRateLimitStorage(db: Db, now: () => Date) {
  return {
    async consume(key: string, rule: { window: number; max: number }) {
      const r = await consume(db, `auth:${key}`, { windowSeconds: rule.window, max: rule.max }, now());
      return { allowed: r.allowed, retryAfter: r.allowed ? null : r.retryAfterSeconds };
    },
  };
}
```

`apps/web/src/server/rate-limit/rules.ts`:
```ts
import type { RateLimitRule } from "./limiter";

/** Spec §9.6. Keys are built by the caller (per user, per IP, per hashed email). */
export const RATE_LIMITS = {
  magicLinkPerEmail: { windowSeconds: 3_600, max: 5 },
  magicLinkPerIp: { windowSeconds: 3_600, max: 20 },
  uploadUrl: { windowSeconds: 3_600, max: 60 },
  designSave: { windowSeconds: 60, max: 120 },
  shareCreate: { windowSeconds: 3_600, max: 30 },
  sharedView: { windowSeconds: 60, max: 120 },
  publish: { windowSeconds: 86_400, max: 5 },
  report: { windowSeconds: 86_400, max: 20 },
  publicRead: { windowSeconds: 60, max: 300 },
} as const satisfies Record<string, RateLimitRule>;
```

`apps/web/src/server/http/client-ip.ts`:
```ts
import { isIP } from "node:net";

/**
 * Route handlers can't see the socket address, so the client IP comes only from a proxy we trust
 * to overwrite X-Forwarded-For (Vercel). Like Better Auth, accept exactly one address; anything
 * else is spoofable, so return null and let callers use a shared "unknown" bucket.
 */
export function clientIp(req: Request, trustProxy: boolean): string | null {
  if (!trustProxy) return null;
  const parts = (req.headers.get("x-forwarded-for") ?? "").split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length !== 1) return null;
  const ip = parts[0]!;
  return isIP(ip) ? ip : null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `corepack pnpm --filter @layer/web exec vitest run src/server/rate-limit src/server/http/client-ip.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/server/rate-limit apps/web/src/server/http/client-ip.ts apps/web/src/server/http/client-ip.test.ts
git commit -m "feat(web): Postgres fixed-window rate limiter shared with Better Auth"
```

---

### Task 4: HTTP kernel — problems, bodies, ids, cursors, logging, `endpoint()`

**Files:**
- Create: `apps/web/src/server/deps.ts`, `apps/web/src/server/logging.ts`
- Create: `apps/web/src/server/http/{types,problem,ids,body,cursor,endpoint}.ts`
- Create: `apps/web/tests/support/{config,deps,invoke,logger}.ts`
- Test: `apps/web/src/server/logging.test.ts`, `apps/web/src/server/http/{body,cursor,ids,endpoint}.test.ts`

**Interfaces:**
- Consumes: `AppConfig`, `Db`, `consume`, `RATE_LIMITS`, `clientIp`, `createTestDb`, `createUser`
- Produces:
  ```ts
  // deps.ts
  interface CurrentUser { id: string; email: string; role: "user" | "admin"; handle: string | null }
  interface Deps { db: Db; config: AppConfig; logger: Logger; now: () => Date; authenticate(req: Request): Promise<CurrentUser | null> }
  // logging.ts
  interface Logger { info(event: string, fields?: LogFields): void; warn(...): void; error(...): void }
  createLogger(write?: (line: string) => void, now?: () => Date): Logger; silentLogger: Logger
  // http/types.ts
  type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>
  // http/problem.ts
  class HttpError(status, title, detail, extra?, headers?); problem(status, title, detail, requestId, extra?, headers?): Response
  notFound(), badRequest(detail, extra?), unprocessable(detail, extra?), conflict(detail, extra?)
  // http/ids.ts
  isUuid(v: string): boolean; parseId(v: string | undefined): string   // throws notFound()
  // http/body.ts
  readJson(req, schema, maxBytes = 65_536); readQuery(req, schema); DEFAULT_BODY_LIMIT
  // http/cursor.ts
  interface Cursor { at: string; id: string }; encodeCursor; decodeCursor (throws 400); pageQuery (zod: cursor?, limit 1..50 default 20)
  toPage<T, J>(rows: T[], limit: number, cursorOf: (r: T) => Cursor, toJson: (r: T) => J): { items: J[]; nextCursor: string | null }
  // http/endpoint.ts
  endpoint(deps, { auth: "none" | "optional" | "user" | "admin"; rateLimit?: { name: string; rule: RateLimitRule; by: "user" | "ip" } },
           fn: ({ req, params, user, requestId }) => Promise<Response>): Handler
  // tests/support
  testConfig: AppConfig; testDeps(db, overrides?): Deps; captureLogger(): Logger & { entries: LogEntry[] }
  call(handler, { method?, path?, params?, body?, rawBody?, as?, headers?, origin?, ip? }): Promise<{ status: number; headers: Headers; body: any }>
  ```
  With `auth: "user"` or `"admin"`, `user` is typed `CurrentUser`. With `"optional"` it is `CurrentUser | null`. With `"none"` it is `null`, and the authenticator is never called.

- [ ] **Step 1: Write the failing unit tests (logging, ids, cursor, body)**

`apps/web/src/server/logging.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { createLogger } from "./logging";

function capture() {
  const lines: Record<string, unknown>[] = [];
  const logger = createLogger((line) => lines.push(JSON.parse(line)), () => new Date("2026-09-25T00:00:00.000Z"));
  return { logger, lines };
}

describe("createLogger", () => {
  it("writes one JSON object per event", () => {
    const { logger, lines } = capture();
    logger.info("request", { requestId: "r1", status: 200 });
    expect(lines).toEqual([{ time: "2026-09-25T00:00:00.000Z", level: "info", event: "request", requestId: "r1", status: 200 }]);
  });

  it("redacts sensitive keys at any depth", () => {
    const { logger, lines } = capture();
    logger.warn("x", { email: "a@b.c", nested: { sessionToken: "t", apiKey: "k", ok: 1 }, headers: { authorization: "Bearer z", cookie: "c" } });
    expect(lines[0]).toMatchObject({
      email: "[redacted]",
      nested: { sessionToken: "[redacted]", apiKey: "[redacted]", ok: 1 },
      headers: { authorization: "[redacted]", cookie: "[redacted]" },
    });
  });

  it("logs errors without SQL parameters", () => {
    const { logger, lines } = capture();
    const err = new Error('Failed query: select * from "user" where email = $1\nparams: riya@example.test');
    err.name = "DrizzleQueryError";
    (err as Error & { cause?: unknown }).cause = Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" });
    logger.error("request.failed", { err });
    const text = JSON.stringify(lines[0]);
    expect(text).not.toContain("riya@example.test");
    expect(text).toContain("connection refused");
  });
});
```

`apps/web/src/server/http/ids.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { HttpError } from "./problem";
import { isUuid, parseId } from "./ids";

describe("ids", () => {
  it("accepts UUIDs and normalises case", () => {
    expect(isUuid("8F14E45F-CEEA-467A-9575-3A6B1C7E3B2D")).toBe(true);
    expect(parseId("8F14E45F-CEEA-467A-9575-3A6B1C7E3B2D")).toBe("8f14e45f-ceea-467a-9575-3a6b1c7e3b2d");
  });
  it.each(["abc", "1'", "", undefined, "8f14e45f-ceea-467a-9575-3a6b1c7e3b2d-x"])("treats %s as not found", (v) => {
    expect(() => parseId(v)).toThrow(HttpError);
    try {
      parseId(v);
    } catch (e) {
      expect((e as HttpError).status).toBe(404);
    }
  });
});
```

`apps/web/src/server/http/cursor.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor, pageQuery, toPage } from "./cursor";

const id = "8f14e45f-ceea-467a-9575-3a6b1c7e3b2d";

describe("cursor", () => {
  it("round-trips", () => {
    const c = { at: "2026-09-25T10:00:00.123Z", id };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
  });
  it.each(["garbage", Buffer.from('["not-a-date","x"]').toString("base64url"), Buffer.from("{}").toString("base64url")])(
    "rejects a tampered cursor %s with 400",
    (s) => {
      expect(() => decodeCursor(s)).toThrow(expect.objectContaining({ status: 400 }));
    },
  );
  it("caps limit at 50 and defaults to 20", () => {
    expect(pageQuery.parse({}).limit).toBe(20);
    expect(pageQuery.safeParse({ limit: "51" }).success).toBe(false);
  });
  it("builds a page and a next cursor only when more rows exist", () => {
    const rows = [1, 2, 3].map((n) => ({ n, at: new Date(n * 1000), id }));
    const page = toPage(rows, 2, (r) => ({ at: r.at.toISOString(), id: r.id }), (r) => r.n);
    expect(page.items).toEqual([1, 2]);
    expect(decodeCursor(page.nextCursor!)).toEqual({ at: rows[1]!.at.toISOString(), id });
    expect(toPage(rows.slice(0, 2), 2, (r) => ({ at: r.at.toISOString(), id }), (r) => r.n).nextCursor).toBeNull();
  });
});
```

`apps/web/src/server/http/body.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { readJson } from "./body";

const Schema = z.object({ name: z.string() }).strict();
const post = (body: BodyInit, type = "application/json") =>
  new Request("http://localhost/", { method: "POST", headers: { "content-type": type }, body });

async function statusOf(p: Promise<unknown>): Promise<number> {
  try {
    await p;
    return 200;
  } catch (e) {
    return (e as { status: number }).status;
  }
}

describe("readJson", () => {
  it("parses a valid body", async () => {
    expect(await readJson(post('{"name":"x"}'), Schema)).toEqual({ name: "x" });
  });
  it("rejects the wrong content type with 415", async () => {
    expect(await statusOf(readJson(post('{"name":"x"}', "text/plain"), Schema))).toBe(415);
  });
  it("rejects bodies over the limit with 413, even without Content-Length", async () => {
    const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(`{"name":"${"x".repeat(100)}"}`)); c.close(); } });
    const req = new Request("http://localhost/", { method: "POST", headers: { "content-type": "application/json" }, body: stream, duplex: "half" } as RequestInit);
    expect(await statusOf(readJson(req, Schema, 32))).toBe(413);
  });
  it("rejects invalid JSON, invalid UTF-8, arrays and unknown keys with 400", async () => {
    expect(await statusOf(readJson(post("{nope"), Schema))).toBe(400);
    expect(await statusOf(readJson(post(new Uint8Array([0x7b, 0xff, 0x7d])), Schema))).toBe(400);
    expect(await statusOf(readJson(post("[]"), Schema))).toBe(400);
    expect(await statusOf(readJson(post('{"name":"x","role":"admin"}'), Schema))).toBe(400);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `corepack pnpm --filter @layer/web exec vitest run src/server/logging.test.ts src/server/http`
Expected: FAIL — modules not found (the client-ip tests still pass).

- [ ] **Step 3: Implement deps, logging, problem, ids, cursor, body**

`apps/web/src/server/deps.ts`:
```ts
import type { AppConfig } from "./config";
import type { Db } from "./db/types";
import type { Logger } from "./logging";

export interface CurrentUser {
  id: string;
  email: string;
  role: "user" | "admin";
  handle: string | null;
}

export interface Deps {
  db: Db;
  config: AppConfig;
  logger: Logger;
  now: () => Date;
  authenticate(req: Request): Promise<CurrentUser | null>;
}
```

`apps/web/src/server/logging.ts`:
```ts
export type LogFields = Record<string, unknown>;

export interface Logger {
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

const SENSITIVE_KEY = /email|token|secret|password|cookie|authorization|api_?key/i;

function redact(value: unknown, depth = 0): unknown {
  if (value instanceof Error) {
    const cause = (value as { cause?: unknown }).cause;
    return {
      name: value.name,
      // Drizzle appends "\nparams: …" with bound values (emails, tokens); never log them.
      message: value.message.split("\nparams:")[0],
      ...(typeof (value as { code?: unknown }).code === "string" ? { code: (value as { code: string }).code } : {}),
      ...(cause !== undefined && depth < 3 ? { cause: redact(cause, depth + 1) } : {}),
    };
  }
  if (value === null || typeof value !== "object" || depth > 4) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k, SENSITIVE_KEY.test(k) ? "[redacted]" : redact(v, depth + 1)]),
  );
}

export function createLogger(
  write: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
  now: () => Date = () => new Date(),
): Logger {
  const at =
    (level: "info" | "warn" | "error") =>
    (event: string, fields: LogFields = {}) =>
      write(JSON.stringify({ time: now().toISOString(), level, event, ...(redact(fields) as LogFields) }));
  return { info: at("info"), warn: at("warn"), error: at("error") };
}

export const silentLogger: Logger = { info() {}, warn() {}, error() {} };
```

`apps/web/src/server/http/types.ts`:
```ts
export interface RouteContext {
  params: Promise<Record<string, string>>;
}

export type Handler = (req: Request, ctx: RouteContext) => Promise<Response>;
```

`apps/web/src/server/http/problem.ts`:
```ts
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly title: string,
    readonly detail: string,
    readonly extra: Record<string, unknown> = {},
    readonly headers: Record<string, string> = {},
  ) {
    super(detail);
    this.name = "HttpError";
  }
}

export const notFound = () => new HttpError(404, "Not Found", "The requested resource does not exist.");
export const badRequest = (detail: string, extra?: Record<string, unknown>) => new HttpError(400, "Bad Request", detail, extra);
export const unprocessable = (detail: string, extra?: Record<string, unknown>) =>
  new HttpError(422, "Unprocessable Content", detail, extra);
export const conflict = (detail: string, extra?: Record<string, unknown>) => new HttpError(409, "Conflict", detail, extra);

/** RFC 9457 problem document. Extension members can't override the standard ones. */
export function problem(
  status: number,
  title: string,
  detail: string,
  requestId: string,
  extra: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify({ ...extra, type: "about:blank", title, status, detail, requestId }), {
    status,
    headers: { ...headers, "content-type": "application/problem+json", "cache-control": "no-store", "x-request-id": requestId },
  });
}
```

`apps/web/src/server/http/ids.ts`:
```ts
import { notFound } from "./problem";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value: string): boolean => UUID.test(value);

/** A path id that isn't a UUID can't match any row; answer 404 instead of letting Postgres fail the cast. */
export function parseId(value: string | undefined): string {
  if (value === undefined || !isUuid(value)) throw notFound();
  return value.toLowerCase();
}
```

`apps/web/src/server/http/cursor.ts`:
```ts
import { z } from "zod";
import { isUuid } from "./ids";
import { badRequest } from "./problem";

export interface Cursor {
  at: string;
  id: string;
}

export const pageQuery = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify([c.at, c.id])).toString("base64url");
}

export function decodeCursor(value: string): Cursor {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      typeof parsed[0] === "string" &&
      !Number.isNaN(Date.parse(parsed[0])) &&
      typeof parsed[1] === "string" &&
      isUuid(parsed[1])
    ) {
      return { at: new Date(parsed[0]).toISOString(), id: parsed[1] };
    }
  } catch {
    // fall through
  }
  throw badRequest("The cursor is invalid.");
}

export function toPage<T, J>(
  rows: T[],
  limit: number,
  cursorOf: (row: T) => Cursor,
  toJson: (row: T) => J,
): { items: J[]; nextCursor: string | null } {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items.at(-1);
  return { items: items.map(toJson), nextCursor: hasMore && last !== undefined ? encodeCursor(cursorOf(last)) : null };
}
```

`apps/web/src/server/http/body.ts`:
```ts
import type { z } from "zod";
import { badRequest, HttpError } from "./problem";

export const DEFAULT_BODY_LIMIT = 64 * 1024;

const tooLarge = (max: number) => new HttpError(413, "Content Too Large", `The request body must be at most ${max} bytes.`);

export async function readJson<S extends z.ZodType>(req: Request, schema: S, maxBytes = DEFAULT_BODY_LIMIT): Promise<z.output<S>> {
  if (!/^application\/json\b/i.test(req.headers.get("content-type") ?? "")) {
    throw new HttpError(415, "Unsupported Media Type", "Send the request body as application/json.");
  }
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge(maxBytes);
  const text = await readText(req, maxBytes);
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw badRequest("The request body is not valid JSON.");
  }
  return parseWith(schema, data, "body");
}

export function readQuery<S extends z.ZodType>(req: Request, schema: S): z.output<S> {
  return parseWith(schema, Object.fromEntries(new URL(req.url).searchParams), "query");
}

function parseWith<S extends z.ZodType>(schema: S, data: unknown, where: "body" | "query"): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw badRequest(`The request ${where} is invalid.`, {
      issues: result.error.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message })),
    });
  }
  return result.data;
}

async function readText(req: Request, maxBytes: number): Promise<string> {
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw tooLarge(maxBytes);
    }
    chunks.push(value);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  } catch {
    throw badRequest("The request body is not valid UTF-8.");
  }
}
```

- [ ] **Step 4: Run the unit tests to verify they pass**

Run: `corepack pnpm --filter @layer/web exec vitest run src/server/logging.test.ts src/server/http`
Expected: PASS (except `endpoint.test.ts`, which doesn't exist yet).

- [ ] **Step 5: Write the test support helpers**

`apps/web/tests/support/config.ts`:
```ts
import type { AppConfig } from "@/server/config";

export const testConfig: AppConfig = {
  nodeEnv: "test",
  isProduction: false,
  databaseUrl: "postgres://unused/test",
  appOrigin: "http://localhost:3000",
  authSecret: "test-secret-that-is-at-least-32-characters-long",
  trustProxy: true,
  google: null,
  mail: { kind: "console" },
};
```

`apps/web/tests/support/logger.ts`:
```ts
import type { LogFields, Logger } from "@/server/logging";

export interface LogEntry {
  level: "info" | "warn" | "error";
  event: string;
  fields: LogFields;
}

export function captureLogger(): Logger & { entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  const at = (level: LogEntry["level"]) => (event: string, fields: LogFields = {}) => void entries.push({ level, event, fields });
  return { entries, info: at("info"), warn: at("warn"), error: at("error") };
}
```

`apps/web/tests/support/deps.ts`:
```ts
import { eq } from "drizzle-orm";
import { user } from "@/server/db/schema";
import type { Db } from "@/server/db/types";
import type { Deps } from "@/server/deps";
import { silentLogger } from "@/server/logging";
import { testConfig } from "./config";

/** Real dependencies except auth: the `x-test-user-id` header names the (real, stored) user. */
export function testDeps(db: Db, overrides: Partial<Deps> = {}): Deps {
  return {
    db,
    config: testConfig,
    logger: silentLogger,
    now: () => new Date(),
    async authenticate(req) {
      const id = req.headers.get("x-test-user-id");
      if (!id) return null;
      const [row] = await db
        .select({ id: user.id, email: user.email, role: user.role, handle: user.handle })
        .from(user)
        .where(eq(user.id, id));
      return row ?? null;
    },
    ...overrides,
  };
}
```

`apps/web/tests/support/invoke.ts`:
```ts
import type { Handler } from "@/server/http/types";
import { testConfig } from "./config";

export interface CallOptions {
  method?: string;
  path?: string;
  params?: Record<string, string>;
  body?: unknown;
  rawBody?: BodyInit;
  as?: { id: string } | null;
  headers?: Record<string, string>;
  /** Defaults to the app origin on non-GET requests; pass null to omit the header. */
  origin?: string | null;
  ip?: string;
}

export async function call(handler: Handler, opts: CallOptions = {}): Promise<{ status: number; headers: Headers; body: any }> {
  const method = opts.method ?? "GET";
  const headers = new Headers(opts.headers);
  if (method !== "GET" && opts.origin !== null) headers.set("origin", opts.origin ?? testConfig.appOrigin);
  if (opts.as) headers.set("x-test-user-id", opts.as.id);
  headers.set("x-forwarded-for", opts.ip ?? "203.0.113.7");
  let body: BodyInit | undefined = opts.rawBody;
  if (opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
  }
  const req = new Request(new URL(opts.path ?? "/api/test", testConfig.appOrigin), { method, headers, body });
  const res = await handler(req, { params: Promise.resolve(opts.params ?? {}) });
  const text = await res.text();
  const isJson = /json/.test(res.headers.get("content-type") ?? "");
  return { status: res.status, headers: res.headers, body: isJson && text ? JSON.parse(text) : text };
}
```

- [ ] **Step 6: Write the failing `endpoint()` tests**

`apps/web/src/server/http/endpoint.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../../tests/support/db";
import { testDeps } from "../../../tests/support/deps";
import { createUser } from "../../../tests/support/factories";
import { call } from "../../../tests/support/invoke";
import { captureLogger } from "../../../tests/support/logger";
import { endpoint } from "./endpoint";
import { HttpError } from "./problem";

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(() => t.close());

const ok = async () => Response.json({ ok: true });

describe("endpoint()", () => {
  it("returns the handler's response with a request id and no-store", async () => {
    const res = await call(endpoint(testDeps(t.db), { auth: "none" }, ok));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects state-changing requests without a same-origin Origin header", async () => {
    const h = endpoint(testDeps(t.db), { auth: "none" }, ok);
    expect((await call(h, { method: "POST", origin: null })).status).toBe(403);
    expect((await call(h, { method: "DELETE", origin: "https://evil.example" })).status).toBe(403);
    expect((await call(h, { method: "PATCH" })).status).toBe(200);
    expect((await call(h, { method: "GET", origin: null })).status).toBe(200);
  });

  it("requires a user, and an admin for admin endpoints", async () => {
    const member = await createUser(t.db);
    const admin = await createUser(t.db, { role: "admin" });
    const needsUser = endpoint(testDeps(t.db), { auth: "user" }, async ({ user }) => Response.json({ id: user.id }));
    const needsAdmin = endpoint(testDeps(t.db), { auth: "admin" }, ok);
    expect((await call(needsUser)).status).toBe(401);
    expect((await call(needsUser, { as: member })).body).toEqual({ id: member.id });
    expect((await call(needsAdmin, { as: member })).status).toBe(403);
    expect((await call(needsAdmin, { as: admin })).status).toBe(200);
  });

  it("renders HttpError as problem+json carrying the same request id as the header", async () => {
    const h = endpoint(testDeps(t.db), { auth: "none" }, async () => {
      throw new HttpError(409, "Conflict", "Version mismatch.", { currentVersion: 4, status: 999 });
    });
    const res = await call(h);
    expect(res.status).toBe(409);
    expect(res.headers.get("content-type")).toBe("application/problem+json");
    expect(res.body).toMatchObject({ type: "about:blank", title: "Conflict", status: 409, detail: "Version mismatch.", currentVersion: 4 });
    expect(res.body.requestId).toBe(res.headers.get("x-request-id"));
  });

  it("hides unexpected errors from the client and logs them without secrets", async () => {
    const logger = captureLogger();
    const h = endpoint(testDeps(t.db, { logger }), { auth: "none" }, async () => {
      throw new Error("connect ECONNREFUSED postgres://layer:hunter2@db\nparams: riya@example.test");
    });
    const res = await call(h);
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toMatch(/hunter2|ECONNREFUSED|riya/);
    const failure = logger.entries.find((e) => e.event === "request.failed");
    expect(failure?.fields.requestId).toBe(res.body.requestId);
  });

  it("rate-limits per user and per IP with Retry-After", async () => {
    const u = await createUser(t.db);
    const rule = { windowSeconds: 60, max: 2 };
    const byUser = endpoint(testDeps(t.db), { auth: "user", rateLimit: { name: "t-user", rule, by: "user" } }, ok);
    const statuses = [];
    for (let i = 0; i < 3; i++) statuses.push((await call(byUser, { as: u })).status);
    expect(statuses).toEqual([200, 200, 429]);

    const byIp = endpoint(testDeps(t.db), { auth: "none", rateLimit: { name: "t-ip", rule, by: "ip" } }, ok);
    await call(byIp, { ip: "198.51.100.1" });
    await call(byIp, { ip: "198.51.100.1" });
    const limited = await call(byIp, { ip: "198.51.100.1" });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await call(byIp, { ip: "198.51.100.2" })).status).toBe(200);
  });

  it("never calls the authenticator for auth: none", async () => {
    let calls = 0;
    const deps = testDeps(t.db, { authenticate: async () => (calls++, null) });
    await call(endpoint(deps, { auth: "none" }, ok));
    expect(calls).toBe(0);
  });

  it("keeps share tokens out of request logs", async () => {
    const logger = captureLogger();
    await call(endpoint(testDeps(t.db, { logger }), { auth: "none" }, ok), { path: "/api/shared/SECRETTOKEN123/remix" });
    expect(JSON.stringify(logger.entries)).not.toContain("SECRETTOKEN123");
  });
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `corepack pnpm --filter @layer/web exec vitest run src/server/http/endpoint.test.ts`
Expected: FAIL — `./endpoint` not found.

- [ ] **Step 8: Implement `endpoint()`**

`apps/web/src/server/http/endpoint.ts`:
```ts
import { randomUUID } from "node:crypto";
import type { CurrentUser, Deps } from "../deps";
import { consume, type RateLimitRule } from "../rate-limit/limiter";
import { clientIp } from "./client-ip";
import { HttpError, problem } from "./problem";
import type { Handler } from "./types";

type AuthMode = "none" | "optional" | "user" | "admin";
type UserFor<A extends AuthMode> = A extends "none" ? null : A extends "optional" ? CurrentUser | null : CurrentUser;

export interface EndpointOptions<A extends AuthMode> {
  auth: A;
  rateLimit?: { name: string; rule: RateLimitRule; by: "user" | "ip" };
}

export interface EndpointInput<U> {
  req: Request;
  params: Record<string, string>;
  user: U;
  requestId: string;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Share tokens are credentials; they must never reach the logs. */
const loggablePath = (pathname: string) => pathname.replace(/^\/api\/shared\/[^/]+/, "/api/shared/:token");

export function endpoint<A extends AuthMode>(
  deps: Deps,
  options: EndpointOptions<A>,
  fn: (input: EndpointInput<UserFor<A>>) => Promise<Response>,
): Handler {
  return async (req, ctx) => {
    const requestId = randomUUID();
    const started = performance.now();
    const path = loggablePath(new URL(req.url).pathname);
    let userId: string | undefined;
    const done = (status: number) =>
      deps.logger.info("request", { requestId, method: req.method, path, status, ms: Math.round(performance.now() - started), userId });

    try {
      if (!SAFE_METHODS.has(req.method) && req.headers.get("origin") !== deps.config.appOrigin) {
        throw new HttpError(403, "Forbidden", "Cross-origin requests are not allowed.");
      }
      const user = options.auth === "none" ? null : await deps.authenticate(req);
      userId = user?.id;
      if ((options.auth === "user" || options.auth === "admin") && !user) {
        throw new HttpError(401, "Unauthorized", "Sign in to continue.");
      }
      if (options.auth === "admin" && user?.role !== "admin") {
        throw new HttpError(403, "Forbidden", "This action requires an administrator.");
      }
      if (options.rateLimit) await enforceRateLimit(deps, req, options.rateLimit, user);

      const res = await fn({ req, params: await ctx.params, user: user as UserFor<A>, requestId });
      res.headers.set("x-request-id", requestId);
      if (!res.headers.has("cache-control")) res.headers.set("cache-control", "no-store");
      done(res.status);
      return res;
    } catch (err) {
      if (err instanceof HttpError) {
        done(err.status);
        return problem(err.status, err.title, err.detail, requestId, err.extra, err.headers);
      }
      deps.logger.error("request.failed", { requestId, method: req.method, path, userId, err });
      return problem(500, "Internal Server Error", "Something went wrong on our side. Quote the request id if you contact support.", requestId);
    }
  };
}

async function enforceRateLimit(
  deps: Deps,
  req: Request,
  limit: NonNullable<EndpointOptions<AuthMode>["rateLimit"]>,
  user: CurrentUser | null,
): Promise<void> {
  const subject = limit.by === "user" && user ? `user:${user.id}` : `ip:${clientIp(req, deps.config.trustProxy) ?? "unknown"}`;
  const verdict = await consume(deps.db, `${limit.name}:${subject}`, limit.rule, deps.now());
  if (!verdict.allowed) {
    throw new HttpError(
      429,
      "Too Many Requests",
      "Rate limit exceeded. Try again later.",
      { retryAfter: verdict.retryAfterSeconds },
      { "retry-after": String(verdict.retryAfterSeconds) },
    );
  }
}
```

- [ ] **Step 9: Run the kernel tests, typecheck, lint**

Run: `corepack pnpm --filter @layer/web exec vitest run src/server && corepack pnpm --filter @layer/web typecheck && corepack pnpm --filter @layer/web lint`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/web
git commit -m "feat(web): HTTP kernel — problem+json, origin check, auth modes, rate limits, body limits, cursors, redacting logger"
```

---

### Task 5: Better Auth — magic links, sessions, current user

**Files:**
- Create: `apps/web/src/server/auth/mailer.ts`, `apps/web/src/server/auth/auth.ts`, `apps/web/src/server/auth/current-user.ts`
- Create: `apps/web/tests/support/mailer.ts`
- Test: `apps/web/src/server/auth/mailer.test.ts`, `apps/web/src/server/auth/auth.test.ts`

**Interfaces:**
- Consumes: `AppConfig`, `authSchema`, `Db`, `consume`, `betterAuthRateLimitStorage`, `RATE_LIMITS`, `problem`, `CurrentUser`, `Logger`
- Produces:
  ```ts
  interface MailMessage { to: string; subject: string; text: string; html: string }
  interface Mailer { send(message: MailMessage): Promise<void> }
  magicLinkEmail(to: string, url: string): MailMessage
  consoleMailer(logger: Logger): Mailer; resendMailer({ apiKey, from }, fetchImpl?): Mailer
  createAuth({ db, config, mailer, now }): Auth;  type Auth
  createAuthRoute(auth: Auth, config: AppConfig): { GET(req: Request): Promise<Response>; POST(req: Request): Promise<Response> }
  loadCurrentUser(db: Db, id: string): Promise<CurrentUser | null>
  createAuthenticator(auth: Pick<Auth, "api">, db: Db): (req: Request) => Promise<CurrentUser | null>
  // tests/support/mailer.ts
  captureMailer(): Mailer & { sent: MailMessage[] }
  ```

- [ ] **Step 1: Write the failing mailer test**

`apps/web/src/server/auth/mailer.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { magicLinkEmail, resendMailer } from "./mailer";

describe("magicLinkEmail", () => {
  it("includes the link as text and as escaped HTML", () => {
    const m = magicLinkEmail("a@b.test", 'https://x.test/verify?token=abc&next="/home"');
    expect(m.text).toContain('https://x.test/verify?token=abc&next="/home"');
    expect(m.html).toContain("token=abc&amp;next=&quot;/home&quot;");
    expect(m.text).toMatch(/expires in 10 minutes/);
  });
});

describe("resendMailer", () => {
  it("posts to the Resend API with a bearer key", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    await resendMailer({ apiKey: "re_test", from: "Layer <hi@layer.test>" }, fakeFetch).send(magicLinkEmail("a@b.test", "https://x.test/v"));
    expect(calls[0]!.url).toBe("https://api.resend.com/emails");
    expect(new Headers(calls[0]!.init.headers).get("authorization")).toBe("Bearer re_test");
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({ from: "Layer <hi@layer.test>", to: ["a@b.test"] });
  });

  it("fails without echoing the provider's response body", async () => {
    const fakeFetch = (async () => new Response("secret provider detail", { status: 422 })) as unknown as typeof fetch;
    const send = resendMailer({ apiKey: "re_test", from: "x@y.test" }, fakeFetch).send(magicLinkEmail("a@b.test", "https://x.test/v"));
    await expect(send).rejects.toThrow("HTTP 422");
    await expect(send).rejects.not.toThrow(/secret provider detail/);
  });
});
```

- [ ] **Step 2: Implement the mailer; run the test**

`apps/web/src/server/auth/mailer.ts`:
```ts
import type { Logger } from "../logging";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function magicLinkEmail(to: string, url: string): MailMessage {
  const note = "This link works once and expires in 10 minutes. If you didn't ask for it, you can ignore this email.";
  return {
    to,
    subject: "Your Layer sign-in link",
    text: `Sign in to Layer:\n\n${url}\n\n${note}`,
    html: `<p>Sign in to Layer:</p><p><a href="${escapeHtml(url)}">Sign in</a></p><p>${note}</p>`,
  };
}

/** Development only (config refuses to boot production without Resend). */
export function consoleMailer(logger: Logger): Mailer {
  return {
    async send(m) {
      logger.info("mail.development", { subject: m.subject, body: m.text });
    },
  };
}

export function resendMailer(options: { apiKey: string; from: string }, fetchImpl: typeof fetch = fetch): Mailer {
  return {
    async send(m) {
      const res = await fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${options.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ from: options.from, to: [m.to], subject: m.subject, text: m.text, html: m.html }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`Resend rejected the email (HTTP ${res.status})`);
    },
  };
}
```

`apps/web/tests/support/mailer.ts`:
```ts
import type { MailMessage, Mailer } from "@/server/auth/mailer";

export function captureMailer(): Mailer & { sent: MailMessage[] } {
  const sent: MailMessage[] = [];
  return {
    sent,
    async send(m) {
      sent.push(m);
    },
  };
}
```

Run: `corepack pnpm --filter @layer/web exec vitest run src/server/auth/mailer.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 3: Write the failing end-to-end auth test (real Better Auth over PGlite)**

`apps/web/src/server/auth/auth.test.ts`:
```ts
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testConfig } from "../../../tests/support/config";
import { createTestDb, type TestDb } from "../../../tests/support/db";
import { captureMailer } from "../../../tests/support/mailer";
import { user, verification } from "../db/schema";
import { createAuth, createAuthRoute, type Auth } from "./auth";
import { createAuthenticator } from "./current-user";

let t: TestDb;
let auth: Auth;
let route: ReturnType<typeof createAuthRoute>;
const mailer = captureMailer();

beforeAll(async () => {
  t = await createTestDb();
  auth = createAuth({ db: t.db, config: testConfig, mailer, now: () => new Date() });
  route = createAuthRoute(auth, testConfig);
});
afterAll(() => t.close());

const origin = testConfig.appOrigin;

function requestLink(body: Record<string, unknown>, ip = "198.51.100.1", requestOrigin: string = origin) {
  return route.POST(
    new Request(`${origin}/api/auth/sign-in/magic-link`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: requestOrigin, "x-forwarded-for": ip },
      body: JSON.stringify({ callbackURL: "/home", ...body }),
    }),
  );
}

function linkSentTo(email: string): URL {
  const message = mailer.sent.findLast((m) => m.to === email);
  const url = message && /https?:\/\/\S+/.exec(message.text)?.[0];
  if (!url) throw new Error(`no link sent to ${email}`);
  return new URL(url);
}

function sessionCookie(res: Response): string | null {
  for (const header of res.headers.getSetCookie()) {
    const pair = header.split(";")[0] ?? "";
    if (/session_token=./.test(pair)) return pair;
  }
  return null;
}

const verify = (link: URL) => route.GET(new Request(link, { headers: { "x-forwarded-for": "198.51.100.1" } }));

describe("magic-link sign-in", () => {
  it("signs a new user in with a single-use, hashed, 10-minute link", async () => {
    const email = "riya@example.test";
    expect((await requestLink({ email })).status).toBe(200);
    const link = linkSentTo(email);
    const token = link.searchParams.get("token");
    expect(token).toBeTruthy();

    const rows = await t.db.select().from(verification);
    expect(rows.some((r) => r.identifier.includes(token!) || r.value.includes(token!))).toBe(false);
    const ttl = Math.max(...rows.map((r) => r.expiresAt.getTime())) - Date.now();
    expect(ttl).toBeGreaterThan(9 * 60_000);
    expect(ttl).toBeLessThanOrEqual(10 * 60_000);

    const first = await verify(link);
    expect(first.status).toBe(302);
    const cookie = sessionCookie(first);
    expect(cookie).toBeTruthy();
    const setCookie = first.headers.getSetCookie().join("\n");
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);

    const current = await createAuthenticator(auth, t.db)(new Request(`${origin}/api/me`, { headers: { cookie: cookie! } }));
    expect(current).toMatchObject({ email, role: "user", handle: null });

    expect(sessionCookie(await verify(link))).toBeNull();
  });

  it("never lets a sign-up body set the role", async () => {
    const email = "sneaky@example.test";
    await requestLink({ email, name: "Sneaky", role: "admin" });
    await verify(linkSentTo(email));
    const [row] = await t.db.select().from(user).where(eq(user.email, email));
    expect(row?.role).toBe("user");
  });

  it("allows 5 links per hour per email", async () => {
    const statuses = [];
    for (let i = 0; i < 6; i++) statuses.push((await requestLink({ email: "flood@example.test" }, `198.51.100.${20 + i}`)).status);
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
  });

  it("allows 20 links per hour per IP", async () => {
    const statuses = [];
    for (let i = 0; i < 21; i++) statuses.push((await requestLink({ email: `ip${i}@example.test` }, "203.0.113.50")).status);
    expect(statuses.slice(0, 20).every((s) => s === 200)).toBe(true);
    expect(statuses[20]).toBe(429);
  });

  it("rejects sign-in requests from another origin", async () => {
    const res = await requestLink({ email: "x@example.test" }, "198.51.100.77", "https://evil.example");
    expect(res.status).toBe(403);
    expect(res.headers.get("content-type")).toBe("application/problem+json");
  });

  it("treats a request without a session as signed out", async () => {
    expect(await createAuthenticator(auth, t.db)(new Request(`${origin}/api/me`))).toBeNull();
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `corepack pnpm --filter @layer/web exec vitest run src/server/auth/auth.test.ts`
Expected: FAIL — `./auth` not found.

- [ ] **Step 5: Implement auth and the current-user lookup**

`apps/web/src/server/auth/auth.ts`:
```ts
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
```

`apps/web/src/server/auth/current-user.ts`:
```ts
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
```

- [ ] **Step 6: Run the auth tests**

Run: `corepack pnpm --filter @layer/web exec vitest run src/server/auth`
Expected: PASS (9 tests). If a test fails, record what Better Auth 1.7.5 actually does:
- The verify status might not be `302`. Assert the status it returns, as long as it still sets the session cookie.
- The per-IP limit might not trip at 21 because the plugin's own rule shadows `customRules`. Keep both and inspect `rate_limits` keys to see which rule applied. Don't loosen the numbers.
- `APIError("TOO_MANY_REQUESTS")` might not map to 429. Use the status name Better Auth exports for 429.

- [ ] **Step 7: Typecheck, lint, commit**

Run: `corepack pnpm --filter @layer/web typecheck && corepack pnpm --filter @layer/web lint`
```bash
git add apps/web
git commit -m "feat(web): Better Auth magic-link sign-in with hashed single-use links, DB sessions, shared rate limits"
```

---

### Task 6: Composition root, security headers, health, and the first routes

**Files:**
- Create: `apps/web/src/server/security/headers.ts`, `apps/web/src/proxy.ts`
- Create: `apps/web/src/server/health/handlers.ts`, `apps/web/src/server/context.ts`
- Create: `apps/web/src/app/api/health/route.ts`, `apps/web/src/app/api/auth/[...all]/route.ts`
- Test: `apps/web/src/server/security/headers.test.ts`, `apps/web/src/proxy.test.ts`, `apps/web/src/server/health/handlers.test.ts`

**Interfaces:**
- Consumes: everything above
- Produces:
  ```ts
  buildCsp({ nonce, isDevelopment }): string; securityHeaders({ csp, isProduction }): Record<string, string>; createNonce(): string
  proxy(request: NextRequest): NextResponse
  healthHandlers(deps): { get: Handler }
  route(pick: (app: App) => Handler | ((req: Request) => Promise<Response>)): Handler   // context.ts
  ```
  Tasks 7–9 each add a line to `build()` in `context.ts` and new `route.ts` files.

- [ ] **Step 1: Write the failing tests**

`apps/web/src/server/security/headers.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { buildCsp, createNonce, securityHeaders } from "./headers";

describe("buildCsp", () => {
  it("locks scripts to the nonce and forbids framing and plugins", () => {
    const csp = buildCsp({ nonce: "abc123", isDevelopment: false });
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("upgrade-insecure-requests");
    expect(csp).not.toContain("unsafe-eval");
  });
  it("allows eval only in development (React refresh)", () => {
    expect(buildCsp({ nonce: "n", isDevelopment: true })).toContain("'unsafe-eval'");
  });
});

describe("securityHeaders", () => {
  it("sets the spec's header set, with HSTS only in production", () => {
    const dev = securityHeaders({ csp: "x", isProduction: false });
    expect(dev).toMatchObject({
      "x-frame-options": "DENY",
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
      "permissions-policy": "camera=(), microphone=(), geolocation=()",
      "cross-origin-opener-policy": "same-origin",
    });
    expect(dev["strict-transport-security"]).toBeUndefined();
    expect(securityHeaders({ csp: "x", isProduction: true })["strict-transport-security"]).toMatch(/max-age=63072000/);
  });
});

describe("createNonce", () => {
  it("is 128 random bits, base64", () => {
    const a = createNonce();
    expect(Buffer.from(a, "base64")).toHaveLength(16);
    expect(createNonce()).not.toBe(a);
  });
});
```

`apps/web/src/proxy.test.ts`:
```ts
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "./proxy";

describe("proxy", () => {
  it("adds a fresh CSP nonce and the security headers to every response", () => {
    const a = proxy(new NextRequest("http://localhost:3000/templates"));
    const b = proxy(new NextRequest("http://localhost:3000/templates"));
    const nonceA = /'nonce-([^']+)'/.exec(a.headers.get("content-security-policy") ?? "")?.[1];
    const nonceB = /'nonce-([^']+)'/.exec(b.headers.get("content-security-policy") ?? "")?.[1];
    expect(nonceA).toBeTruthy();
    expect(nonceA).not.toBe(nonceB);
    expect(a.headers.get("x-frame-options")).toBe("DENY");
    expect(a.headers.get("x-content-type-options")).toBe("nosniff");
  });
});
```

`apps/web/src/server/health/handlers.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../../tests/support/db";
import { testDeps } from "../../../tests/support/deps";
import { call } from "../../../tests/support/invoke";
import type { Db } from "../db/types";
import { healthHandlers } from "./handlers";

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(() => t.close());

describe("GET /api/health", () => {
  it("reports ok when the database answers", async () => {
    const res = await call(healthHandlers(testDeps(t.db)).get);
    expect(res).toMatchObject({ status: 200, body: { status: "ok" } });
  });
  it("reports 503 without detail when the database is down", async () => {
    const broken = { execute: () => Promise.reject(new Error("ECONNREFUSED 10.0.0.5:5432")) } as unknown as Db;
    const res = await call(healthHandlers(testDeps(broken)).get);
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: "unavailable" });
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `corepack pnpm --filter @layer/web exec vitest run src/proxy.test.ts src/server/security src/server/health`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement headers, proxy, health**

`apps/web/src/server/security/headers.ts`:
```ts
export function createNonce(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64");
}

/** Plan 2 adds the R2 origins to img-src and connect-src. */
export function buildCsp({ nonce, isDevelopment }: { nonce: string; isDevelopment: boolean }): string {
  const directives: [string, ...string[]][] = [
    ["default-src", "'self'"],
    ["script-src", "'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(isDevelopment ? ["'unsafe-eval'"] : [])],
    ["style-src", "'self'", "'unsafe-inline'"],
    ["img-src", "'self'", "blob:", "data:"],
    ["font-src", "'self'"],
    ["connect-src", "'self'"],
    ["object-src", "'none'"],
    ["base-uri", "'self'"],
    ["form-action", "'self'"],
    ["frame-ancestors", "'none'"],
    ...(isDevelopment ? [] : [["upgrade-insecure-requests"] as [string]]),
  ];
  return directives.map((d) => d.join(" ")).join("; ");
}

export function securityHeaders({ csp, isProduction }: { csp: string; isProduction: boolean }): Record<string, string> {
  return {
    "content-security-policy": csp,
    "x-frame-options": "DENY",
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
    "cross-origin-opener-policy": "same-origin",
    ...(isProduction ? { "strict-transport-security": "max-age=63072000; includeSubDomains; preload" } : {}),
  };
}
```

`apps/web/src/proxy.ts`:
```ts
import { NextResponse, type NextRequest } from "next/server";
import { buildCsp, createNonce, securityHeaders } from "./server/security/headers";

/** Next 16 "proxy" (formerly middleware): a per-request CSP nonce that Next applies to its own scripts. */
export function proxy(request: NextRequest): NextResponse {
  const nonce = createNonce();
  const csp = buildCsp({ nonce, isDevelopment: process.env.NODE_ENV === "development" });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  for (const [name, value] of Object.entries(securityHeaders({ csp, isProduction: process.env.NODE_ENV === "production" }))) {
    response.headers.set(name, value);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
```

`apps/web/src/server/health/handlers.ts`:
```ts
import { sql } from "drizzle-orm";
import type { Deps } from "../deps";
import { endpoint } from "../http/endpoint";

export function healthHandlers(deps: Deps) {
  return {
    get: endpoint(deps, { auth: "none" }, async () => {
      try {
        await deps.db.execute(sql`select 1`);
      } catch (err) {
        deps.logger.error("health.db_unreachable", { err });
        return Response.json({ status: "unavailable" }, { status: 503 });
      }
      return Response.json({ status: "ok" });
    }),
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm --filter @layer/web exec vitest run src/proxy.test.ts src/server/security src/server/health`
Expected: PASS (7 tests).

- [ ] **Step 5: Add the composition root and route files**

`apps/web/src/server/context.ts`:
```ts
import "server-only";
import { createAuth, createAuthRoute } from "./auth/auth";
import { createAuthenticator } from "./auth/current-user";
import { consoleMailer, resendMailer } from "./auth/mailer";
import { loadConfig } from "./config";
import { createDb } from "./db/client";
import type { Deps } from "./deps";
import { healthHandlers } from "./health/handlers";
import type { Handler } from "./http/types";
import { createLogger } from "./logging";

function build() {
  const config = loadConfig(process.env);
  const logger = createLogger();
  const { db } = createDb(config.databaseUrl);
  const now = () => new Date();
  const mailer = config.mail.kind === "resend" ? resendMailer(config.mail) : consoleMailer(logger);
  const auth = createAuth({ db, config, mailer, now });
  const deps: Deps = { db, config, logger, now, authenticate: createAuthenticator(auth, db) };
  return {
    auth: createAuthRoute(auth, config),
    health: healthHandlers(deps),
  };
}

export type App = ReturnType<typeof build>;

let app: App | undefined;

/** Lazy, so `next build` never needs runtime env; built once per server instance on the first request. */
export function route(pick: (app: App) => Handler | ((req: Request) => Promise<Response>)): Handler {
  return (req, ctx) => pick((app ??= build()))(req, ctx);
}
```

`apps/web/src/app/api/health/route.ts`:
```ts
import { route } from "@/server/context";

export const GET = route((app) => app.health.get);
```

`apps/web/src/app/api/auth/[...all]/route.ts`:
```ts
import { route } from "@/server/context";

export const GET = route((app) => app.auth.GET);
export const POST = route((app) => app.auth.POST);
```

- [ ] **Step 6: Full verification including a production build**

Run: `corepack pnpm --filter @layer/web test && corepack pnpm --filter @layer/web typecheck && corepack pnpm --filter @layer/web lint && corepack pnpm --filter @layer/web build`
Expected: all green. The build lists `ƒ /api/health`, `ƒ /api/auth/[...all]` and `ƒ Proxy`. The build must succeed with no env set. That proves the composition root is lazy.

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "feat(web): security headers with per-request CSP nonce, health check, auth route, composition root"
```

---

### Task 7: Folders (owner-scoped CRUD + IDOR tests)

**Files:**
- Create: `apps/web/src/server/folders/repository.ts`, `apps/web/src/server/folders/handlers.ts`
- Create: `apps/web/src/app/api/folders/route.ts`, `apps/web/src/app/api/folders/[id]/route.ts`
- Modify: `apps/web/src/server/context.ts` (add `folders: folderHandlers(deps)` to `build()`)
- Test: `apps/web/src/server/folders/handlers.test.ts`

**Interfaces:**
- Consumes: `endpoint`, `readJson`, `readQuery`, `pageQuery`, `decodeCursor`, `toPage`, `parseId`, `notFound`, `LIMITS` (from `@layer/schema`)
- Produces:
  ```ts
  listFolders(db, ownerId, { cursor?: Cursor; limit }): Promise<FolderRow[]>   // returns limit + 1 rows
  createFolder(db, ownerId, name, now): Promise<FolderRow>
  renameFolder(db, ownerId, id, name, now): Promise<FolderRow | undefined>
  deleteFolder(db, ownerId, id): Promise<boolean>
  folderExists(db, ownerId, id): Promise<boolean>
  folderHandlers(deps): { list; create; rename; remove }
  // JSON: { id, name, createdAt, updatedAt }  (ownerId is never serialised)
  ```

- [ ] **Step 1: Write the failing tests**

`apps/web/src/server/folders/handlers.test.ts`:
```ts
import { createEmptyDoc } from "@layer/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../../tests/support/db";
import { testDeps } from "../../../tests/support/deps";
import { createFolder, createUser } from "../../../tests/support/factories";
import { call } from "../../../tests/support/invoke";
import { designs, folders } from "../db/schema";
import { folderHandlers } from "./handlers";

let t: TestDb;
let h: ReturnType<typeof folderHandlers>;
beforeAll(async () => {
  t = await createTestDb();
  h = folderHandlers(testDeps(t.db));
});
afterAll(() => t.close());

describe("folders", () => {
  it("creates a folder and never exposes the owner", async () => {
    const alice = await createUser(t.db);
    const res = await call(h.create, { method: "POST", as: alice, body: { name: "  Birthdays  " } });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: expect.any(String), name: "Birthdays", createdAt: expect.any(String), updatedAt: expect.any(String) });
  });

  it.each([{ name: "" }, { name: "x".repeat(81) }, { name: "ok", ownerId: "someone-else" }, {}])("rejects body %j with 400", async (body) => {
    const alice = await createUser(t.db);
    expect((await call(h.create, { method: "POST", as: alice, body })).status).toBe(400);
  });

  it("lists only the caller's folders, paginated oldest first", async () => {
    const alice = await createUser(t.db);
    const bob = await createUser(t.db);
    for (const name of ["A", "B", "C"]) await call(h.create, { method: "POST", as: alice, body: { name } });
    await createFolder(t.db, bob.id, "Bob's");

    const first = await call(h.list, { as: alice, path: "/api/folders?limit=2" });
    expect(first.body.items.map((f: { name: string }) => f.name)).toEqual(["A", "B"]);
    const second = await call(h.list, { as: alice, path: `/api/folders?limit=2&cursor=${first.body.nextCursor}` });
    expect(second.body).toMatchObject({ items: [{ name: "C" }], nextCursor: null });
    expect((await call(h.list, { as: alice, path: "/api/folders?limit=51" })).status).toBe(400);
  });

  it("renames and deletes only the caller's folders (404 for anyone else's)", async () => {
    const alice = await createUser(t.db);
    const bob = await createUser(t.db);
    const folder = await createFolder(t.db, alice.id);
    const params = { id: folder.id };

    expect((await call(h.rename, { method: "PATCH", as: bob, params, body: { name: "Mine now" } })).status).toBe(404);
    expect((await call(h.remove, { method: "DELETE", as: bob, params })).status).toBe(404);
    const [still] = await t.db.select().from(folders).where(eq(folders.id, folder.id));
    expect(still?.name).toBe("Birthdays");

    expect((await call(h.rename, { method: "PATCH", as: alice, params, body: { name: "Weddings" } })).body.name).toBe("Weddings");
    expect((await call(h.remove, { method: "DELETE", as: alice, params })).status).toBe(204);
  });

  it.each(["not-a-uuid", "1'", "00000000-0000-4000-8000-000000000000"])("answers 404 for id %s", async (id) => {
    const alice = await createUser(t.db);
    expect((await call(h.rename, { method: "PATCH", as: alice, params: { id }, body: { name: "x" } })).status).toBe(404);
  });

  it("keeps designs when their folder is deleted", async () => {
    const alice = await createUser(t.db);
    const folder = await createFolder(t.db, alice.id);
    const [design] = await t.db
      .insert(designs)
      .values({ ownerId: alice.id, folderId: folder.id, title: "Card", doc: createEmptyDoc({ id: "d", kind: "design", title: "Card", format: "ig-post" }) })
      .returning();
    await call(h.remove, { method: "DELETE", as: alice, params: { id: folder.id } });
    const [after] = await t.db.select().from(designs).where(eq(designs.id, design!.id));
    expect(after?.folderId).toBeNull();
  });

  it("requires sign-in and a same-origin request", async () => {
    const alice = await createUser(t.db);
    expect((await call(h.list)).status).toBe(401);
    expect((await call(h.create, { method: "POST", as: alice, origin: null, body: { name: "x" } })).status).toBe(403);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm --filter @layer/web exec vitest run src/server/folders`
Expected: FAIL — `./handlers` not found.

- [ ] **Step 3: Implement**

`apps/web/src/server/folders/repository.ts`:
```ts
import { and, asc, eq, sql } from "drizzle-orm";
import { folders } from "../db/schema";
import type { Db } from "../db/types";
import type { Cursor } from "../http/cursor";

export type FolderRow = typeof folders.$inferSelect;

export function listFolders(db: Db, ownerId: string, page: { cursor?: Cursor; limit: number }): Promise<FolderRow[]> {
  return db
    .select()
    .from(folders)
    .where(
      and(
        eq(folders.ownerId, ownerId),
        page.cursor ? sql`(${folders.createdAt}, ${folders.id}) > (${page.cursor.at}::timestamptz, ${page.cursor.id}::uuid)` : undefined,
      ),
    )
    .orderBy(asc(folders.createdAt), asc(folders.id))
    .limit(page.limit + 1);
}

export async function createFolder(db: Db, ownerId: string, name: string, now: Date): Promise<FolderRow> {
  const [row] = await db.insert(folders).values({ ownerId, name, createdAt: now, updatedAt: now }).returning();
  return row!;
}

export async function renameFolder(db: Db, ownerId: string, id: string, name: string, now: Date): Promise<FolderRow | undefined> {
  const [row] = await db
    .update(folders)
    .set({ name, updatedAt: now })
    .where(and(eq(folders.id, id), eq(folders.ownerId, ownerId)))
    .returning();
  return row;
}

export async function deleteFolder(db: Db, ownerId: string, id: string): Promise<boolean> {
  const rows = await db.delete(folders).where(and(eq(folders.id, id), eq(folders.ownerId, ownerId))).returning({ id: folders.id });
  return rows.length > 0;
}

export async function folderExists(db: Db, ownerId: string, id: string): Promise<boolean> {
  const rows = await db.select({ id: folders.id }).from(folders).where(and(eq(folders.id, id), eq(folders.ownerId, ownerId)));
  return rows.length > 0;
}
```

`apps/web/src/server/folders/handlers.ts`:
```ts
import { LIMITS } from "@layer/schema";
import { z } from "zod";
import type { Deps } from "../deps";
import { readJson, readQuery } from "../http/body";
import { decodeCursor, pageQuery, toPage } from "../http/cursor";
import { endpoint } from "../http/endpoint";
import { parseId } from "../http/ids";
import { notFound } from "../http/problem";
import { createFolder, deleteFolder, listFolders, renameFolder, type FolderRow } from "./repository";

const FolderBody = z.object({ name: z.string().trim().min(1).max(LIMITS.nameChars) }).strict();

const toJson = (f: FolderRow) => ({ id: f.id, name: f.name, createdAt: f.createdAt.toISOString(), updatedAt: f.updatedAt.toISOString() });

export function folderHandlers(deps: Deps) {
  return {
    list: endpoint(deps, { auth: "user" }, async ({ req, user }) => {
      const q = readQuery(req, pageQuery);
      const rows = await listFolders(deps.db, user.id, { cursor: q.cursor ? decodeCursor(q.cursor) : undefined, limit: q.limit });
      return Response.json(toPage(rows, q.limit, (r) => ({ at: r.createdAt.toISOString(), id: r.id }), toJson));
    }),

    create: endpoint(deps, { auth: "user" }, async ({ req, user }) => {
      const body = await readJson(req, FolderBody);
      return Response.json(toJson(await createFolder(deps.db, user.id, body.name, deps.now())), { status: 201 });
    }),

    rename: endpoint(deps, { auth: "user" }, async ({ req, user, params }) => {
      const id = parseId(params.id);
      const body = await readJson(req, FolderBody);
      const row = await renameFolder(deps.db, user.id, id, body.name, deps.now());
      if (!row) throw notFound();
      return Response.json(toJson(row));
    }),

    remove: endpoint(deps, { auth: "user" }, async ({ user, params }) => {
      if (!(await deleteFolder(deps.db, user.id, parseId(params.id)))) throw notFound();
      return new Response(null, { status: 204 });
    }),
  };
}
```

`apps/web/src/app/api/folders/route.ts`:
```ts
import { route } from "@/server/context";

export const GET = route((app) => app.folders.list);
export const POST = route((app) => app.folders.create);
```

`apps/web/src/app/api/folders/[id]/route.ts`:
```ts
import { route } from "@/server/context";

export const PATCH = route((app) => app.folders.rename);
export const DELETE = route((app) => app.folders.remove);
```

In `context.ts`, add `import { folderHandlers } from "./folders/handlers";` and `folders: folderHandlers(deps),` to the object `build()` returns.

- [ ] **Step 4: Run tests, typecheck, lint**

Run: `corepack pnpm --filter @layer/web exec vitest run src/server/folders && corepack pnpm --filter @layer/web typecheck && corepack pnpm --filter @layer/web lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): owner-scoped folders API with keyset pagination and cross-user tests"
```

---

### Task 8: Designs (validation, asset ownership, optimistic concurrency, duplicate)

**Files:**
- Create: `apps/web/src/server/assets/repository.ts`
- Create: `apps/web/src/server/designs/{repository,service,handlers}.ts`
- Create: `apps/web/src/app/api/designs/route.ts`, `apps/web/src/app/api/designs/[id]/route.ts`, `apps/web/src/app/api/designs/[id]/duplicate/route.ts`
- Create: `apps/web/tests/support/docs.ts`
- Modify: `apps/web/src/server/context.ts` (add `designs: designHandlers(deps)`)
- Test: `apps/web/src/server/designs/handlers.test.ts`

**Interfaces:**
- Consumes: `parseDoc`, `LIMITS`, `type Doc` (from `@layer/schema`); `folderExists`; kernel helpers; `RATE_LIMITS.designSave`
- Produces:
  ```ts
  findUnusableAssets(db, ownerId, refs: { id: string; kind: "photo" | "sticker" }[]): Promise<string[]>
  // designs/service.ts — ctx = { db: Db; now: () => Date }
  createDesign(ctx, ownerId, { title?, folderId?, doc: unknown }): Promise<DesignRow>
  saveDesignDoc(ctx, ownerId, id, { doc: unknown; version: number }): Promise<DesignRow>   // 404 | 409 { currentVersion } | 422
  updateDesignMeta(ctx, ownerId, id, { title?, folderId? }): Promise<DesignRow>
  duplicateDesign(ctx, ownerId, id): Promise<DesignRow>
  // JSON summary: { id, title, folderId, thumbnailAssetId, version, createdAt, updatedAt }
  // JSON full:    summary + { doc, sourceTemplateId, sourceTemplateVersion }
  ```
- Rules:
  - `designs.title` mirrors `doc.meta.title`. A rename rewrites both and bumps `version`, so an editor open in another tab gets 409 and shows the conflict dialog from spec §11.2.
  - The server overwrites `doc.id` with the design id.
  - Every entry in `doc.assets` must be a `ready` asset of the same kind that the caller owns, or that is system-owned or public. Otherwise the response is 422 with `assetIds`.

- [ ] **Step 1: Add the doc helpers for tests**

`apps/web/tests/support/docs.ts`:
```ts
import { createEmptyDoc, defaultFilters, type Doc } from "@layer/schema";

export function emptyDoc(title = "Birthday card"): Doc {
  return createEmptyDoc({ id: "draft", kind: "design", title, format: "ig-post" });
}

export function docWithPhoto(assetId: string): Doc {
  const doc = emptyDoc();
  doc.nodes.photo1 = {
    id: "photo1",
    type: "frame",
    name: "Photo",
    transform: { x: 540, y: 540, rotation: 0, scaleX: 1, scaleY: 1 },
    width: 800,
    height: 600,
    opacity: 1,
    visible: true,
    lock: "free",
    shape: { kind: "rect", cornerRadius: 0 },
    content: { assetId, offsetX: 0, offsetY: 0, scale: 1 },
    filters: defaultFilters(),
    placeholder: false,
  };
  doc.root.push("photo1");
  doc.assets[assetId] = { id: assetId, kind: "photo", mime: "image/jpeg", width: 1200, height: 900 };
  return doc;
}
```

- [ ] **Step 2: Write the failing tests**

`apps/web/src/server/designs/handlers.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../../tests/support/db";
import { testDeps } from "../../../tests/support/deps";
import { docWithPhoto, emptyDoc } from "../../../tests/support/docs";
import { createAsset, createFolder, createUser } from "../../../tests/support/factories";
import { call } from "../../../tests/support/invoke";
import { designHandlers } from "./handlers";

let t: TestDb;
let h: ReturnType<typeof designHandlers>;
beforeAll(async () => {
  t = await createTestDb();
  h = designHandlers(testDeps(t.db));
});
afterAll(() => t.close());

async function newDesign(owner: { id: string }, doc: unknown = emptyDoc()) {
  const res = await call(h.create, { method: "POST", as: owner, body: { doc } });
  expect(res.status).toBe(201);
  return res.body as { id: string; version: number; title: string; doc: { id: string } };
}

describe("create", () => {
  it("validates the document, stamps its id and takes the title from it", async () => {
    const alice = await createUser(t.db);
    const d = await newDesign(alice);
    expect(d).toMatchObject({ version: 1, title: "Birthday card" });
    expect(d.doc.id).toBe(d.id);
  });

  it("rejects an invalid document with 422 and issues", async () => {
    const alice = await createUser(t.db);
    const res = await call(h.create, { method: "POST", as: alice, body: { doc: { ...emptyDoc(), root: ["ghost"] } } });
    expect(res.status).toBe(422);
    expect(res.body.issues.length).toBeGreaterThan(0);
  });

  it("accepts own ready photos and system assets; rejects pending, foreign-private and wrong-kind assets", async () => {
    const alice = await createUser(t.db);
    const bob = await createUser(t.db);
    const own = await createAsset(t.db, { ownerId: alice.id });
    const system = await createAsset(t.db, { ownerId: null });
    const pending = await createAsset(t.db, { ownerId: alice.id, status: "pending" });
    const bobs = await createAsset(t.db, { ownerId: bob.id });
    const thumb = await createAsset(t.db, { ownerId: alice.id, kind: "thumbnail" });

    for (const ok of [own, system]) expect((await call(h.create, { method: "POST", as: alice, body: { doc: docWithPhoto(ok.id) } })).status).toBe(201);
    for (const bad of [pending, bobs, thumb]) {
      const res = await call(h.create, { method: "POST", as: alice, body: { doc: docWithPhoto(bad.id) } });
      expect(res.status).toBe(422);
      expect(res.body.assetIds).toEqual([bad.id]);
    }
  });

  it("only files designs into the caller's own folders", async () => {
    const alice = await createUser(t.db);
    const bob = await createUser(t.db);
    const bobsFolder = await createFolder(t.db, bob.id);
    expect((await call(h.create, { method: "POST", as: alice, body: { doc: emptyDoc(), folderId: bobsFolder.id } })).status).toBe(422);
  });

  it("rejects mass-assignment fields", async () => {
    const alice = await createUser(t.db);
    for (const extra of [{ ownerId: "x" }, { version: 9 }, { id: "00000000-0000-4000-8000-000000000000" }]) {
      expect((await call(h.create, { method: "POST", as: alice, body: { doc: emptyDoc(), ...extra } })).status).toBe(400);
    }
  });
});

describe("read and list", () => {
  it("lists the caller's designs newest first without documents, filtered by folder", async () => {
    const alice = await createUser(t.db);
    const bob = await createUser(t.db);
    const folder = await createFolder(t.db, alice.id);
    const first = await newDesign(alice);
    const second = await newDesign(alice);
    await call(h.create, { method: "POST", as: alice, body: { doc: emptyDoc(), folderId: folder.id } });
    await newDesign(bob);

    const all = await call(h.list, { as: alice, path: "/api/designs?limit=2" });
    expect(all.body.items).toHaveLength(2);
    expect(all.body.items[0].doc).toBeUndefined();
    const rest = await call(h.list, { as: alice, path: `/api/designs?limit=2&cursor=${all.body.nextCursor}` });
    const ids = [...all.body.items, ...rest.body.items].map((d: { id: string }) => d.id);
    expect(ids).toHaveLength(3);
    expect(ids.indexOf(second.id)).toBeLessThan(ids.indexOf(first.id));

    const filed = await call(h.list, { as: alice, path: `/api/designs?folderId=${folder.id}` });
    expect(filed.body.items).toHaveLength(1);
  });

  it("returns 404 for someone else's design and for malformed ids", async () => {
    const alice = await createUser(t.db);
    const bob = await createUser(t.db);
    const d = await newDesign(alice);
    expect((await call(h.get, { as: alice, params: { id: d.id } })).body.doc.id).toBe(d.id);
    expect((await call(h.get, { as: bob, params: { id: d.id } })).status).toBe(404);
    expect((await call(h.get, { as: alice, params: { id: "nope" } })).status).toBe(404);
  });
});

describe("autosave (PUT)", () => {
  it("saves with the current version and bumps it", async () => {
    const alice = await createUser(t.db);
    const d = await newDesign(alice);
    const res = await call(h.save, { method: "PUT", as: alice, params: { id: d.id }, body: { doc: emptyDoc("Renamed in editor"), version: 1 } });
    expect(res.body).toMatchObject({ version: 2, title: "Renamed in editor" });
  });

  it("answers 409 with the current version when stale", async () => {
    const alice = await createUser(t.db);
    const d = await newDesign(alice);
    await call(h.save, { method: "PUT", as: alice, params: { id: d.id }, body: { doc: emptyDoc(), version: 1 } });
    const stale = await call(h.save, { method: "PUT", as: alice, params: { id: d.id }, body: { doc: emptyDoc(), version: 1 } });
    expect(stale.status).toBe(409);
    expect(stale.body.currentVersion).toBe(2);
  });

  it("lets exactly one of two concurrent saves of the same version win", async () => {
    const alice = await createUser(t.db);
    const d = await newDesign(alice);
    const save = () => call(h.save, { method: "PUT", as: alice, params: { id: d.id }, body: { doc: emptyDoc(), version: 1 } });
    const statuses = (await Promise.all([save(), save()])).map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409]);
  });

  it("returns 404 (not 409 or 422) for someone else's design", async () => {
    const alice = await createUser(t.db);
    const bob = await createUser(t.db);
    const d = await newDesign(alice);
    expect((await call(h.save, { method: "PUT", as: bob, params: { id: d.id }, body: { doc: emptyDoc(), version: 1 } })).status).toBe(404);
    expect((await call(h.save, { method: "PUT", as: bob, params: { id: d.id }, body: { doc: {}, version: 1 } })).status).toBe(404);
  });

  it("rejects bodies over the document size limit with 413", async () => {
    const alice = await createUser(t.db);
    const d = await newDesign(alice);
    const huge = JSON.stringify({ doc: { pad: "x".repeat(1_100_000) }, version: 1 });
    expect((await call(h.save, { method: "PUT", as: alice, params: { id: d.id }, rawBody: huge, headers: { "content-type": "application/json" } })).status).toBe(413);
  });

  it("rate-limits saves to 120 per minute per user", async () => {
    const carol = await createUser(t.db);
    const fixed = new Date("2026-09-25T10:00:30.000Z");
    const limited = designHandlers(testDeps(t.db, { now: () => fixed }));
    const d = await newDesign(carol);
    let last = 0;
    for (let i = 0; i < 121; i++) last = (await call(limited.save, { method: "PUT", as: carol, params: { id: d.id }, body: { doc: emptyDoc(), version: 1 + i } })).status;
    expect(last).toBe(429);
  });
});

describe("metadata, delete, duplicate", () => {
  it("renames by rewriting doc.meta.title and bumping the version", async () => {
    const alice = await createUser(t.db);
    const d = await newDesign(alice);
    const res = await call(h.patch, { method: "PATCH", as: alice, params: { id: d.id }, body: { title: "Diwali" } });
    expect(res.body).toMatchObject({ title: "Diwali", version: 2 });
    expect((await call(h.get, { as: alice, params: { id: d.id } })).body.doc.meta.title).toBe("Diwali");
  });

  it("rejects empty or unknown patch fields", async () => {
    const alice = await createUser(t.db);
    const d = await newDesign(alice);
    expect((await call(h.patch, { method: "PATCH", as: alice, params: { id: d.id }, body: {} })).status).toBe(400);
    expect((await call(h.patch, { method: "PATCH", as: alice, params: { id: d.id }, body: { version: 7 } })).status).toBe(400);
  });

  it("moves between the caller's folders only", async () => {
    const alice = await createUser(t.db);
    const bob = await createUser(t.db);
    const d = await newDesign(alice);
    const mine = await createFolder(t.db, alice.id);
    const his = await createFolder(t.db, bob.id);
    expect((await call(h.patch, { method: "PATCH", as: alice, params: { id: d.id }, body: { folderId: mine.id } })).body.folderId).toBe(mine.id);
    expect((await call(h.patch, { method: "PATCH", as: alice, params: { id: d.id }, body: { folderId: his.id } })).status).toBe(422);
    expect((await call(h.patch, { method: "PATCH", as: alice, params: { id: d.id }, body: { folderId: null } })).body.folderId).toBeNull();
  });

  it("deletes and duplicates only the caller's designs", async () => {
    const alice = await createUser(t.db);
    const bob = await createUser(t.db);
    const d = await newDesign(alice);

    expect((await call(h.duplicate, { method: "POST", as: bob, params: { id: d.id } })).status).toBe(404);
    const copy = await call(h.duplicate, { method: "POST", as: alice, params: { id: d.id } });
    expect(copy.status).toBe(201);
    expect(copy.body).toMatchObject({ title: "Copy of Birthday card", version: 1 });
    expect(copy.body.id).not.toBe(d.id);
    expect(copy.body.doc.id).toBe(copy.body.id);

    expect((await call(h.remove, { method: "DELETE", as: bob, params: { id: d.id } })).status).toBe(404);
    expect((await call(h.remove, { method: "DELETE", as: alice, params: { id: d.id } })).status).toBe(204);
    expect((await call(h.get, { as: alice, params: { id: d.id } })).status).toBe(404);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `corepack pnpm --filter @layer/web exec vitest run src/server/designs`
Expected: FAIL — `./handlers` not found.

- [ ] **Step 4: Implement the asset check and the design repository**

`apps/web/src/server/assets/repository.ts`:
```ts
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { assets } from "../db/schema";
import type { Db } from "../db/types";
import { isUuid } from "../http/ids";

/**
 * Returns the ids from `refs` the owner may NOT place in a document: anything that isn't a ready
 * asset of the claimed kind that the owner owns, the system owns, or that is public.
 */
export async function findUnusableAssets(db: Db, ownerId: string, refs: { id: string; kind: "photo" | "sticker" }[]): Promise<string[]> {
  const candidates = refs.map((r) => r.id).filter(isUuid).map((id) => id.toLowerCase());
  const rows =
    candidates.length === 0
      ? []
      : await db
          .select({ id: assets.id, kind: assets.kind })
          .from(assets)
          .where(
            and(
              inArray(assets.id, candidates),
              eq(assets.status, "ready"),
              or(eq(assets.ownerId, ownerId), isNull(assets.ownerId), eq(assets.visibility, "public")),
            ),
          );
  const usable = new Map(rows.map((r) => [r.id, r.kind]));
  return refs.filter((r) => usable.get(r.id.toLowerCase()) !== r.kind).map((r) => r.id);
}
```

`apps/web/src/server/designs/repository.ts`:
```ts
import { and, desc, eq, sql } from "drizzle-orm";
import type { Doc } from "@layer/schema";
import { designs } from "../db/schema";
import type { Db } from "../db/types";
import type { Cursor } from "../http/cursor";

export type DesignRow = typeof designs.$inferSelect;
export type DesignSummary = Omit<DesignRow, "doc" | "ownerId" | "sourceTemplateId" | "sourceTemplateVersion">;

const summaryColumns = {
  id: designs.id,
  title: designs.title,
  folderId: designs.folderId,
  thumbnailAssetId: designs.thumbnailAssetId,
  version: designs.version,
  createdAt: designs.createdAt,
  updatedAt: designs.updatedAt,
};

const owned = (ownerId: string, id: string) => and(eq(designs.id, id), eq(designs.ownerId, ownerId));

export function listDesigns(db: Db, ownerId: string, q: { folderId?: string; cursor?: Cursor; limit: number }): Promise<DesignSummary[]> {
  return db
    .select(summaryColumns)
    .from(designs)
    .where(
      and(
        eq(designs.ownerId, ownerId),
        q.folderId ? eq(designs.folderId, q.folderId) : undefined,
        q.cursor ? sql`(${designs.updatedAt}, ${designs.id}) < (${q.cursor.at}::timestamptz, ${q.cursor.id}::uuid)` : undefined,
      ),
    )
    .orderBy(desc(designs.updatedAt), desc(designs.id))
    .limit(q.limit + 1);
}

export async function getDesign(db: Db, ownerId: string, id: string): Promise<DesignRow | undefined> {
  const [row] = await db.select().from(designs).where(owned(ownerId, id));
  return row;
}

export async function getDesignVersion(db: Db, ownerId: string, id: string): Promise<number | undefined> {
  const [row] = await db.select({ version: designs.version }).from(designs).where(owned(ownerId, id));
  return row?.version;
}

export async function insertDesign(db: Db, values: typeof designs.$inferInsert): Promise<DesignRow> {
  const [row] = await db.insert(designs).values(values).returning();
  return row!;
}

/** Compare-and-swap on `version`: the WHERE clause makes concurrent saves of one version mutually exclusive. */
export async function updateDesignDoc(db: Db, ownerId: string, id: string, expectedVersion: number, doc: Doc, now: Date): Promise<DesignRow | undefined> {
  const [row] = await db
    .update(designs)
    .set({ doc, title: doc.meta.title, version: sql`${designs.version} + 1`, updatedAt: now })
    .where(and(owned(ownerId, id), eq(designs.version, expectedVersion)))
    .returning();
  return row;
}

export async function updateDesignMeta(
  db: Db,
  ownerId: string,
  id: string,
  patch: { title?: string; folderId?: string | null },
  now: Date,
): Promise<DesignRow | undefined> {
  const [row] = await db
    .update(designs)
    .set({
      updatedAt: now,
      ...(patch.folderId !== undefined ? { folderId: patch.folderId } : {}),
      ...(patch.title !== undefined
        ? {
            title: patch.title,
            doc: sql`jsonb_set(${designs.doc}, '{meta,title}', to_jsonb(${patch.title}::text))`,
            version: sql`${designs.version} + 1`,
          }
        : {}),
    })
    .where(owned(ownerId, id))
    .returning();
  return row;
}

export async function deleteDesign(db: Db, ownerId: string, id: string): Promise<boolean> {
  return (await db.delete(designs).where(owned(ownerId, id)).returning({ id: designs.id })).length > 0;
}
```

- [ ] **Step 5: Implement the service and handlers**

`apps/web/src/server/designs/service.ts`:
```ts
import { randomUUID } from "node:crypto";
import { LIMITS, parseDoc, type Doc } from "@layer/schema";
import { findUnusableAssets } from "../assets/repository";
import type { Db } from "../db/types";
import { folderExists } from "../folders/repository";
import { conflict, notFound, unprocessable } from "../http/problem";
import * as repo from "./repository";

export interface ServiceContext {
  db: Db;
  now: () => Date;
}

async function checkDoc(db: Db, ownerId: string, raw: unknown, designId: string): Promise<Doc> {
  const parsed = parseDoc(raw);
  if (!parsed.ok) throw unprocessable("The document is invalid.", { issues: parsed.issues.slice(0, 50) });
  const doc: Doc = { ...parsed.doc, id: designId };
  const unusable = await findUnusableAssets(db, ownerId, Object.values(doc.assets));
  if (unusable.length > 0) throw unprocessable("The document references assets you can't use.", { assetIds: unusable });
  return doc;
}

async function assertFolder(db: Db, ownerId: string, folderId: string | null | undefined): Promise<void> {
  if (folderId && !(await folderExists(db, ownerId, folderId))) {
    throw unprocessable("folderId does not refer to one of your folders.");
  }
}

export async function createDesign(
  ctx: ServiceContext,
  ownerId: string,
  input: { title?: string; folderId?: string | null; doc: unknown },
): Promise<repo.DesignRow> {
  const id = randomUUID();
  const doc = await checkDoc(ctx.db, ownerId, input.doc, id);
  if (input.title !== undefined) doc.meta = { ...doc.meta, title: input.title };
  await assertFolder(ctx.db, ownerId, input.folderId);
  const now = ctx.now();
  return repo.insertDesign(ctx.db, { id, ownerId, folderId: input.folderId ?? null, title: doc.meta.title, doc, createdAt: now, updatedAt: now });
}

export async function saveDesignDoc(ctx: ServiceContext, ownerId: string, id: string, input: { doc: unknown; version: number }): Promise<repo.DesignRow> {
  if ((await repo.getDesignVersion(ctx.db, ownerId, id)) === undefined) throw notFound();
  const doc = await checkDoc(ctx.db, ownerId, input.doc, id);
  const saved = await repo.updateDesignDoc(ctx.db, ownerId, id, input.version, doc, ctx.now());
  if (saved) return saved;
  const current = await repo.getDesignVersion(ctx.db, ownerId, id);
  if (current === undefined) throw notFound();
  throw conflict("This design changed since you loaded it.", { currentVersion: current });
}

export async function updateDesignMeta(
  ctx: ServiceContext,
  ownerId: string,
  id: string,
  patch: { title?: string; folderId?: string | null },
): Promise<repo.DesignRow> {
  if ((await repo.getDesignVersion(ctx.db, ownerId, id)) === undefined) throw notFound();
  await assertFolder(ctx.db, ownerId, patch.folderId);
  const row = await repo.updateDesignMeta(ctx.db, ownerId, id, patch, ctx.now());
  if (!row) throw notFound();
  return row;
}

export async function duplicateDesign(ctx: ServiceContext, ownerId: string, id: string): Promise<repo.DesignRow> {
  const source = await repo.getDesign(ctx.db, ownerId, id);
  if (!source) throw notFound();
  const copyId = randomUUID();
  const title = `Copy of ${source.title}`.slice(0, LIMITS.titleChars);
  const now = ctx.now();
  return repo.insertDesign(ctx.db, {
    id: copyId,
    ownerId,
    folderId: source.folderId,
    title,
    doc: { ...source.doc, id: copyId, meta: { ...source.doc.meta, title } },
    sourceTemplateId: source.sourceTemplateId,
    sourceTemplateVersion: source.sourceTemplateVersion,
    thumbnailAssetId: source.thumbnailAssetId,
    createdAt: now,
    updatedAt: now,
  });
}
```

`apps/web/src/server/designs/handlers.ts`:
```ts
import { LIMITS } from "@layer/schema";
import { z } from "zod";
import type { Deps } from "../deps";
import { readJson, readQuery } from "../http/body";
import { decodeCursor, pageQuery, toPage } from "../http/cursor";
import { endpoint } from "../http/endpoint";
import { parseId } from "../http/ids";
import { notFound } from "../http/problem";
import { RATE_LIMITS } from "../rate-limit/rules";
import * as repo from "./repository";
import * as service from "./service";

const Title = z.string().trim().min(1).max(LIMITS.titleChars);
const FolderId = z.uuid().nullable();
const DOC_BODY_LIMIT = LIMITS.docBytes + 16 * 1024;

const CreateBody = z.object({ title: Title.optional(), folderId: FolderId.optional(), doc: z.unknown() }).strict();
const SaveBody = z.object({ doc: z.unknown(), version: z.number().int().positive() }).strict();
const PatchBody = z
  .object({ title: Title.optional(), folderId: FolderId.optional() })
  .strict()
  .refine((b) => b.title !== undefined || b.folderId !== undefined, "Provide title or folderId.");
const ListQuery = pageQuery.extend({ folderId: z.uuid().optional() });

const summary = (d: repo.DesignSummary) => ({
  id: d.id,
  title: d.title,
  folderId: d.folderId,
  thumbnailAssetId: d.thumbnailAssetId,
  version: d.version,
  createdAt: d.createdAt.toISOString(),
  updatedAt: d.updatedAt.toISOString(),
});
const full = (d: repo.DesignRow) => ({ ...summary(d), doc: d.doc, sourceTemplateId: d.sourceTemplateId, sourceTemplateVersion: d.sourceTemplateVersion });

export function designHandlers(deps: Deps) {
  const ctx = { db: deps.db, now: deps.now };
  return {
    list: endpoint(deps, { auth: "user" }, async ({ req, user }) => {
      const q = readQuery(req, ListQuery);
      const rows = await repo.listDesigns(deps.db, user.id, { folderId: q.folderId, cursor: q.cursor ? decodeCursor(q.cursor) : undefined, limit: q.limit });
      return Response.json(toPage(rows, q.limit, (r) => ({ at: r.updatedAt.toISOString(), id: r.id }), summary));
    }),

    create: endpoint(deps, { auth: "user" }, async ({ req, user }) => {
      const body = await readJson(req, CreateBody, DOC_BODY_LIMIT);
      return Response.json(full(await service.createDesign(ctx, user.id, body)), { status: 201 });
    }),

    get: endpoint(deps, { auth: "user" }, async ({ user, params }) => {
      const row = await repo.getDesign(deps.db, user.id, parseId(params.id));
      if (!row) throw notFound();
      return Response.json(full(row));
    }),

    save: endpoint(deps, { auth: "user", rateLimit: { name: "designSave", rule: RATE_LIMITS.designSave, by: "user" } }, async ({ req, user, params }) => {
      const id = parseId(params.id);
      const body = await readJson(req, SaveBody, DOC_BODY_LIMIT);
      return Response.json(full(await service.saveDesignDoc(ctx, user.id, id, body)));
    }),

    patch: endpoint(deps, { auth: "user" }, async ({ req, user, params }) => {
      const id = parseId(params.id);
      const body = await readJson(req, PatchBody);
      return Response.json(full(await service.updateDesignMeta(ctx, user.id, id, body)));
    }),

    remove: endpoint(deps, { auth: "user" }, async ({ user, params }) => {
      if (!(await repo.deleteDesign(deps.db, user.id, parseId(params.id)))) throw notFound();
      return new Response(null, { status: 204 });
    }),

    duplicate: endpoint(deps, { auth: "user" }, async ({ user, params }) => {
      return Response.json(full(await service.duplicateDesign(ctx, user.id, parseId(params.id))), { status: 201 });
    }),
  };
}
```

Route files:

`apps/web/src/app/api/designs/route.ts`:
```ts
import { route } from "@/server/context";

export const GET = route((app) => app.designs.list);
export const POST = route((app) => app.designs.create);
```

`apps/web/src/app/api/designs/[id]/route.ts`:
```ts
import { route } from "@/server/context";

export const GET = route((app) => app.designs.get);
export const PUT = route((app) => app.designs.save);
export const PATCH = route((app) => app.designs.patch);
export const DELETE = route((app) => app.designs.remove);
```

`apps/web/src/app/api/designs/[id]/duplicate/route.ts`:
```ts
import { route } from "@/server/context";

export const POST = route((app) => app.designs.duplicate);
```

In `context.ts`, add `import { designHandlers } from "./designs/handlers";` and `designs: designHandlers(deps),`.

- [ ] **Step 6: Run tests, typecheck, lint**

Run: `corepack pnpm --filter @layer/web exec vitest run src/server/designs && corepack pnpm --filter @layer/web typecheck && corepack pnpm --filter @layer/web lint`
Expected: PASS. If the rate-limit test's loop gets 409s before reaching 429, that's fine: only the last status is asserted, and every request still counts against the limit. If `parseDoc` rejects `{ ...emptyDoc(), root: ["ghost"] }` for a reason other than the dangling root, the test still holds, because it only asserts 422 plus issues.

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "feat(web): designs API with document validation, asset ownership checks, optimistic concurrency"
```

---

### Task 9: Me — profile, onboarding, data export, account deletion

**Files:**
- Create: `apps/web/src/server/db/errors.ts`, `apps/web/src/server/me/service.ts`, `apps/web/src/server/me/handlers.ts`
- Create: `apps/web/src/app/api/me/route.ts`, `apps/web/src/app/api/me/export/route.ts`
- Modify: `apps/web/src/server/context.ts` (add `me: meHandlers(deps)`)
- Test: `apps/web/src/server/me/handlers.test.ts`

**Interfaces:**
- Consumes: `CATEGORIES`, `LIMITS`; the `user`, `folders`, `designs`, `assets`, `templates`, `auditLog` and `storageDeletions` tables; kernel helpers
- Produces:
  ```ts
  pgErrorCode(err: unknown): string | undefined; isUniqueViolation(err: unknown): boolean
  getProfile(db, userId); updateProfile(db, userId, patch, now); deleteAccount(db, userId, now); exportAccount(db, userId, now)
  meHandlers(deps): { get; patch; remove; export }
  // Profile JSON: { id, email, name, image, handle, role, interests, onboardedAt, createdAt }
  ```
- Rules:
  - A handle is 3–30 characters from `a-z 0-9 _`, is stored lowercased, can't be one of the reserved words below, and must be unique (409 otherwise).
  - `interests` must be a subset of `CATEGORIES`, at most 10, with duplicates removed.
  - `completeOnboarding: true` requires a handle.
  - Deleting an account queues every owned asset's storage key in `storage_deletions`, appends to `audit_log`, then deletes the user, which cascades to their other rows. All of this happens in one transaction.

- [ ] **Step 1: Write the failing tests**

`apps/web/src/server/me/handlers.test.ts`:
```ts
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../../tests/support/db";
import { testDeps } from "../../../tests/support/deps";
import { emptyDoc } from "../../../tests/support/docs";
import { createAsset, createFolder, createUser } from "../../../tests/support/factories";
import { call } from "../../../tests/support/invoke";
import { auditLog, designs, folders, storageDeletions, user } from "../db/schema";
import { meHandlers } from "./handlers";

let t: TestDb;
let h: ReturnType<typeof meHandlers>;
beforeAll(async () => {
  t = await createTestDb();
  h = meHandlers(testDeps(t.db));
});
afterAll(() => t.close());

describe("GET /api/me", () => {
  it("returns the caller's profile and requires sign-in", async () => {
    const alice = await createUser(t.db, { name: "Alice" });
    expect((await call(h.get, { as: alice })).body).toMatchObject({ id: alice.id, email: alice.email, name: "Alice", role: "user", handle: null, interests: [] });
    expect((await call(h.get)).status).toBe(401);
  });
});

describe("PATCH /api/me", () => {
  it("sets a normalised handle and interests", async () => {
    const alice = await createUser(t.db);
    const res = await call(h.patch, { method: "PATCH", as: alice, body: { handle: "Riya_Designs", interests: ["birthday", "birthday", "travel"] } });
    expect(res.body).toMatchObject({ handle: "riya_designs", interests: ["birthday", "travel"] });
  });

  it.each([{ handle: "ab" }, { handle: "has space" }, { handle: "admin" }, { interests: ["not-a-category"] }, { role: "admin" }, { email: "x@y.z" }])(
    "rejects %j with 400",
    async (body) => {
      const alice = await createUser(t.db);
      expect((await call(h.patch, { method: "PATCH", as: alice, body })).status).toBe(400);
      const [row] = await t.db.select().from(user).where(eq(user.id, alice.id));
      expect(row?.role).toBe("user");
    },
  );

  it("answers 409 when the handle is taken", async () => {
    const alice = await createUser(t.db, { handle: "taken_handle" });
    const bob = await createUser(t.db);
    expect(alice.handle).toBe("taken_handle");
    expect((await call(h.patch, { method: "PATCH", as: bob, body: { handle: "taken_handle" } })).status).toBe(409);
  });

  it("finishes onboarding only once a handle exists", async () => {
    const alice = await createUser(t.db);
    expect((await call(h.patch, { method: "PATCH", as: alice, body: { completeOnboarding: true } })).status).toBe(422);
    const done = await call(h.patch, { method: "PATCH", as: alice, body: { handle: "alice_ok", completeOnboarding: true } });
    expect(done.body.onboardedAt).toEqual(expect.any(String));
  });
});

describe("GET /api/me/export", () => {
  it("exports the caller's data as an attachment and nothing of anyone else's", async () => {
    const alice = await createUser(t.db);
    const bob = await createUser(t.db);
    await createFolder(t.db, alice.id, "Alice's folder");
    await createFolder(t.db, bob.id, "Bob's folder");
    await t.db.insert(designs).values({ ownerId: alice.id, title: "Mine", doc: emptyDoc("Mine") });
    const res = await call(h.export, { as: alice });
    expect(res.headers.get("content-disposition")).toMatch(/attachment; filename="layer-export\.json"/);
    expect(res.body.profile.id).toBe(alice.id);
    expect(res.body.folders.map((f: { name: string }) => f.name)).toEqual(["Alice's folder"]);
    expect(res.body.designs[0].doc.meta.title).toBe("Mine");
    expect(JSON.stringify(res.body)).not.toContain("Bob's folder");
  });
});

describe("DELETE /api/me", () => {
  it("deletes the account, queues storage deletions and writes the audit log", async () => {
    const alice = await createUser(t.db);
    const bob = await createUser(t.db);
    await createFolder(t.db, alice.id);
    const privateAsset = await createAsset(t.db, { ownerId: alice.id });
    const publicAsset = await createAsset(t.db, { ownerId: alice.id, visibility: "public" });
    const bobsFolder = await createFolder(t.db, bob.id);

    expect((await call(h.remove, { method: "DELETE", as: alice })).status).toBe(204);

    expect(await t.db.select().from(user).where(eq(user.id, alice.id))).toEqual([]);
    expect(await t.db.select().from(folders).where(eq(folders.ownerId, alice.id))).toEqual([]);
    const queued = await t.db.select().from(storageDeletions);
    expect(queued).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ bucket: "private", storageKey: privateAsset.storageKey }),
        expect.objectContaining({ bucket: "public", storageKey: publicAsset.storageKey }),
      ]),
    );
    const [entry] = await t.db.select().from(auditLog).where(eq(auditLog.targetId, alice.id));
    expect(entry).toMatchObject({ actorId: alice.id, action: "account.delete", targetType: "user", meta: { assets: 2 } });
    expect(await t.db.select().from(folders).where(eq(folders.id, bobsFolder.id))).toHaveLength(1);
  });

  it("requires a same-origin request", async () => {
    const alice = await createUser(t.db);
    expect((await call(h.remove, { method: "DELETE", as: alice, origin: "https://evil.example" })).status).toBe(403);
    expect(await t.db.select().from(user).where(eq(user.id, alice.id))).toHaveLength(1);
  });
});
```


- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm --filter @layer/web exec vitest run src/server/me`
Expected: FAIL — `./handlers` not found.

- [ ] **Step 3: Implement**

`apps/web/src/server/db/errors.ts`:
```ts
/** SQLSTATE of a Postgres error, looking through Drizzle's DrizzleQueryError wrapper. */
export function pgErrorCode(err: unknown): string | undefined {
  let current: unknown = err;
  for (let depth = 0; current && depth < 3; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

export const isUniqueViolation = (err: unknown): boolean => pgErrorCode(err) === "23505";
```

`apps/web/src/server/me/service.ts`:
```ts
import { asc, eq } from "drizzle-orm";
import { assets, auditLog, designs, folders, storageDeletions, templates, user } from "../db/schema";
import { isUniqueViolation } from "../db/errors";
import type { Db } from "../db/types";
import { conflict, notFound, unprocessable } from "../http/problem";

type UserRow = typeof user.$inferSelect;

export const toProfile = (u: UserRow) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  image: u.image,
  handle: u.handle,
  role: u.role,
  interests: u.interests,
  onboardedAt: u.onboardedAt?.toISOString() ?? null,
  createdAt: u.createdAt.toISOString(),
});

export async function getProfile(db: Db, userId: string): Promise<UserRow> {
  const [row] = await db.select().from(user).where(eq(user.id, userId));
  if (!row) throw notFound();
  return row;
}

export interface ProfilePatch {
  name?: string;
  handle?: string;
  interests?: string[];
  completeOnboarding?: true;
}

export async function updateProfile(db: Db, userId: string, patch: ProfilePatch, now: Date): Promise<UserRow> {
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .update(user)
        .set({
          updatedAt: now,
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.handle !== undefined ? { handle: patch.handle } : {}),
          ...(patch.interests !== undefined ? { interests: [...new Set(patch.interests)] } : {}),
        })
        .where(eq(user.id, userId))
        .returning();
      if (!row) throw notFound();
      if (!patch.completeOnboarding || row.onboardedAt) return row;
      if (!row.handle) throw unprocessable("Choose a handle before finishing onboarding.");
      const [done] = await tx.update(user).set({ onboardedAt: now }).where(eq(user.id, userId)).returning();
      return done!;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("That handle is already taken.");
    throw err;
  }
}

/** One transaction: queue object deletions, record the deletion, then cascade every owned row. */
export async function deleteAccount(db: Db, userId: string, now: Date): Promise<void> {
  await db.transaction(async (tx) => {
    const owned = await tx.select({ storageKey: assets.storageKey, visibility: assets.visibility }).from(assets).where(eq(assets.ownerId, userId));
    if (owned.length > 0) {
      await tx.insert(storageDeletions).values(owned.map((a) => ({ bucket: a.visibility, storageKey: a.storageKey, createdAt: now })));
    }
    await tx.insert(auditLog).values({
      actorId: userId,
      action: "account.delete",
      targetType: "user",
      targetId: userId,
      meta: { assets: owned.length },
      createdAt: now,
    });
    await tx.delete(user).where(eq(user.id, userId));
  });
}

export async function exportAccount(db: Db, userId: string, now: Date) {
  const profile = await getProfile(db, userId);
  const [folderRows, designRows, assetRows, templateRows] = await Promise.all([
    db.select({ id: folders.id, name: folders.name, createdAt: folders.createdAt }).from(folders).where(eq(folders.ownerId, userId)).orderBy(asc(folders.createdAt)),
    db
      .select({ id: designs.id, title: designs.title, folderId: designs.folderId, doc: designs.doc, version: designs.version, createdAt: designs.createdAt, updatedAt: designs.updatedAt })
      .from(designs)
      .where(eq(designs.ownerId, userId))
      .orderBy(asc(designs.createdAt)),
    db
      .select({ id: assets.id, kind: assets.kind, visibility: assets.visibility, mime: assets.mime, bytes: assets.bytes, width: assets.width, height: assets.height, createdAt: assets.createdAt })
      .from(assets)
      .where(eq(assets.ownerId, userId)),
    db
      .select({ id: templates.id, title: templates.title, description: templates.description, category: templates.category, tags: templates.tags, status: templates.status, currentVersion: templates.currentVersion, createdAt: templates.createdAt })
      .from(templates)
      .where(eq(templates.authorId, userId)),
  ]);
  return { exportedAt: now.toISOString(), profile: toProfile(profile), folders: folderRows, designs: designRows, assets: assetRows, templates: templateRows };
}
```

`apps/web/src/server/me/handlers.ts`:
```ts
import { CATEGORIES, LIMITS } from "@layer/schema";
import { z } from "zod";
import type { Deps } from "../deps";
import { readJson } from "../http/body";
import { endpoint } from "../http/endpoint";
import { deleteAccount, exportAccount, getProfile, toProfile, updateProfile } from "./service";

const RESERVED_HANDLES = new Set([
  "admin", "administrator", "api", "app", "auth", "author", "designs", "edit", "help", "home", "layer", "media", "me",
  "moderation", "onboarding", "publish", "root", "s", "settings", "signin", "signup", "support", "system", "templates", "u",
]);

const PatchMe = z
  .object({
    name: z.string().trim().min(1).max(LIMITS.nameChars).optional(),
    handle: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9_]{3,30}$/, "Use 3–30 characters: a–z, 0–9 and _.")
      .refine((h) => !RESERVED_HANDLES.has(h), "This handle is reserved.")
      .optional(),
    interests: z.array(z.string().refine((c) => CATEGORIES.includes(c), "Unknown category.")).max(10).optional(),
    completeOnboarding: z.literal(true).optional(),
  })
  .strict();

export function meHandlers(deps: Deps) {
  return {
    get: endpoint(deps, { auth: "user" }, async ({ user }) => Response.json(toProfile(await getProfile(deps.db, user.id)))),

    patch: endpoint(deps, { auth: "user" }, async ({ req, user }) => {
      const patch = await readJson(req, PatchMe);
      return Response.json(toProfile(await updateProfile(deps.db, user.id, patch, deps.now())));
    }),

    remove: endpoint(deps, { auth: "user" }, async ({ user }) => {
      await deleteAccount(deps.db, user.id, deps.now());
      return new Response(null, { status: 204 });
    }),

    export: endpoint(deps, { auth: "user" }, async ({ user }) =>
      Response.json(await exportAccount(deps.db, user.id, deps.now()), {
        headers: { "content-disposition": 'attachment; filename="layer-export.json"' },
      }),
    ),
  };
}
```

`apps/web/src/app/api/me/route.ts`:
```ts
import { route } from "@/server/context";

export const GET = route((app) => app.me.get);
export const PATCH = route((app) => app.me.patch);
export const DELETE = route((app) => app.me.remove);
```

`apps/web/src/app/api/me/export/route.ts`:
```ts
import { route } from "@/server/context";

export const GET = route((app) => app.me.export);
```

In `context.ts`, add `import { meHandlers } from "./me/handlers";` and `me: meHandlers(deps),`.

- [ ] **Step 4: Run tests, typecheck, lint**

Run: `corepack pnpm --filter @layer/web exec vitest run src/server/me && corepack pnpm --filter @layer/web typecheck && corepack pnpm --filter @layer/web lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): me API — profile, onboarding, data export, audited account deletion"
```

---

### Task 10: CI and security workflows, decision log

**Files:**
- Create: `.github/workflows/ci.yml`, `.github/workflows/security.yml`, `.github/dependabot.yml`
- Modify: `docs/decisions.md` (append rows 15–20)

`deploy.yml` belongs to Plan 3, together with Vercel, Neon and R2 provisioning. There is nothing to deploy against until then.

- [ ] **Step 1: Write the CI workflow**

`.github/workflows/ci.yml`:
```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  verify:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    services:
      postgres:
        image: postgres:17
        env:
          POSTGRES_USER: layer
          POSTGRES_PASSWORD: layer
          POSTGRES_DB: layer
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U layer"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 10
    env:
      DATABASE_URL: postgres://layer:layer@localhost:5432/layer
      APP_ORIGIN: http://localhost:3000
      BETTER_AUTH_SECRET: ci-only-secret-used-nowhere-else-0000000000
    steps:
      - uses: actions/checkout@v5
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v5
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test
      - name: Migrations apply to real Postgres 17
        run: pnpm db:migrate
      - run: pnpm build
```

- [ ] **Step 2: Write the security workflow and Dependabot config**

`.github/workflows/security.yml`:
```yaml
name: Security

on:
  pull_request:
  push:
    branches: [main]
  schedule:
    - cron: "0 6 * * 1"

permissions:
  contents: read

jobs:
  codeql:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      security-events: write
    steps:
      - uses: actions/checkout@v5
      - uses: github/codeql-action/init@v4
        with:
          languages: javascript-typescript
      - uses: github/codeql-action/analyze@v4

  dependency-review:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/dependency-review-action@v4
        with:
          fail-on-severity: high

  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v5
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm audit --audit-level high

  gitleaks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
        with:
          fetch-depth: 0
      - uses: gitleaks/gitleaks-action@v2
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

`.github/dependabot.yml`:
```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: weekly
    groups:
      minor-and-patch:
        update-types: [minor, patch]
  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
```

- [ ] **Step 3: Record the decisions this plan made**

Append to the table in `docs/decisions.md`:
```markdown
| 15 | 2026-09-25 | **One rate limiter.** The Postgres fixed-window limiter (`rate_limits`) also backs Better Auth through `rateLimit.customStorage.consume`; Better Auth's own `rateLimit` table is not created. | One atomic upsert serves the API and auth routes; one table to clean up. |
| 16 | 2026-09-25 | **Client IP only from a trusted proxy.** Route handlers can't see the socket address (spec §9.6 said "socket address"). Without `TRUST_PROXY=true` all clients share the `unknown` IP bucket and Better Auth IP tracking is off; per-email and per-user limits still apply. Only a single-entry `X-Forwarded-For` is accepted (same rule as Better Auth). | Never key limits on a spoofable header. |
| 17 | 2026-09-25 | **CSP:** scripts are `'nonce-…' 'strict-dynamic'`; `style-src` allows `'unsafe-inline'` for Next/Tailwind inline styles. | Script injection is the XSS risk that matters; style nonces break framework-inserted styles. |
| 18 | 2026-09-25 | **Admin endpoints answer 403 to non-admins;** owner-scoped resources answer 404 to non-owners. | The admin API's existence is public; a resource's existence is not. |
| 19 | 2026-09-25 | **Design title mirrors `doc.meta.title`;** renaming rewrites both and bumps `version`, so an open editor gets 409 → conflict dialog. | One source of truth, no silent overwrite of a rename by a stale autosave. |
| 20 | 2026-09-25 | **Magic-link POST also passes our strict Origin check,** in addition to Better Auth's own checks. | Stops other sites from triggering sign-in emails (email bombing, login CSRF). |
```

- [ ] **Step 4: Run the full local equivalent of CI**

Run: `corepack pnpm install --frozen-lockfile && corepack pnpm lint && corepack pnpm typecheck && corepack pnpm test && corepack pnpm build`
Expected: all green across `packages/schema` and `apps/web`. The `db:migrate` step against real Postgres runs in CI only, because Docker isn't available locally. PGlite already applies the same SQL in every test file.

- [ ] **Step 5: Commit**

```bash
git add .github docs/decisions.md
git commit -m "ci: CI with Postgres 17 migrations, CodeQL, dependency review, audit, gitleaks, Dependabot"
```

---

## Self-Review Notes

- **Spec coverage (Plan 1 scope):**
  - §9.1 stack: Tasks 1, 2 and 5.
  - §9.2 every table: Task 2.
  - §9.3: Auth (Task 5), Me (Task 9), Folders (Task 7), Designs (Task 8), `/api/health` (Task 6). Share, Assets, Templates, Users, Admin and `/api/cron/cleanup` are in Plan 2.
  - §9.5 controls: account takeover (Task 5), IDOR (Tasks 7–9), CSRF (Tasks 4 and 5), clickjacking, sniffing and downgrade headers (Task 6), secret leakage (Tasks 1 and 4, plus gitleaks in Task 10), supply chain (Task 10), privacy export and deletion (Task 9), accountability (Tasks 2 and 9). Malicious uploads, malicious documents at publish, publish privacy scrub and share-link guessing are in Plan 2. Document validation and asset ownership on save are in Task 8.
  - §9.6: all rules are defined (Task 3). Magic-link and design-save limits are enforced here; the rest in Plan 2.
  - §9.7: structured logs with `requestId` (Task 4), health (Task 6), config validation at boot (Tasks 1 and 6). Cron is in Plan 2.
  - §9.8: `ci.yml`, `security.yml` and Dependabot (Task 10). `deploy.yml` is in Plan 3.
- **Type consistency:** `Deps`, `CurrentUser`, `Handler`, `endpoint` options, `RateLimitRule`, `findUnusableAssets` and the `route()` picker are named identically in every task that uses them.
- **Known uncertainty:** three Better Auth 1.7.5 runtime behaviours (verify status code, precedence of the plugin's rate rule, 429 mapping) are pinned by tests in Task 5, with instructions for when a test disagrees.

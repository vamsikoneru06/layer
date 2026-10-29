# Plan 4: Deploy and Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put VASH into production on free tiers with a safe deploy pipeline, error tracking, uptime monitoring, cron alerts and encrypted database backups, so a broken build never reaches users and a production failure always reaches the owner.

**Architecture:** GitHub Actions owns deploys: after CI passes on `main`, `deploy.yml` applies migrations to Neon over the direct connection, builds with the Vercel CLI, creates a production deployment that is not yet live (`--skip-domain`), checks its health and only then promotes it. The app reports errors to Sentry through its own `/api/monitoring` tunnel (no CSP change, no third-party script host), with every event scrubbed of query strings, share tokens, emails and SQL parameters. UptimeRobot polls a database-free liveness endpoint so Neon can still scale to zero.

**Tech Stack:** Next.js 16 on Vercel Hobby (region `sin1`), Neon Postgres (pooled URL for the app, direct URL for migrations and backups), `@sentry/nextjs` 11, `@vercel/functions` (`attachDatabasePool`), Vercel CLI, GitHub Actions, UptimeRobot (no code).

**Spec:** `docs/superpowers/specs/2026-09-24-vash-design.md` §5 (hosting), §9.7 (operations), §9.8 (CI/CD), §11.2 (error handling).

## Global Constraints

- Everything free: Vercel Hobby, Neon free (100 CU-hours a month, 0.5 GB, scales to zero after 5 minutes idle), Sentry Developer (5,000 errors a month, 1 cron monitor, 1 user), UptimeRobot free (5-minute checks). No card anywhere.
- Secrets only in Vercel project env, GitHub environment secrets, or `apps/web/.env.local`. Never in code, logs, workflow output or docs.
- Never log or report tokens, signed URLs, emails, cookies or SQL parameters (AGENTS.md). Sentry events get the same treatment as the JSON logger.
- CSP stays strict: no new script, connect, font or image host. The browser talks to Sentry only through `/api/monitoring` on our own origin.
- `/privacy` must name Sentry and what it receives, in the same PR (AGENTS.md, Legal).
- User-facing copy: no em dashes, plain and true. Buttons are rounded rectangles (`glass-btn`, `glass-primary`).
- Every part is optional at runtime: with no `NEXT_PUBLIC_SENTRY_DSN` the app runs exactly as today (dev, tests, CI).
- Migrations must be backward compatible with the code already live (expand, deploy, then contract), because they run before the new code is promoted.

## Review Focus

1. **Signed URLs or share tokens leaking into Sentry** through breadcrumbs (`fetch` to Supabase with `X-Amz-Signature`), page URLs (`/s/<token>`, `/api/shared/<token>`) or error messages. Expected: every URL in an event loses its query string and fragment, and token path segments become `:token`. Pinned in Task 2.
2. **The tunnel used as an open relay or quota burner.** Expected: `/api/monitoring` forwards only envelopes whose DSN matches ours, caps the body size, rate-limits by IP and rejects cross-origin posts. Pinned in Task 3.
3. **A deploy that breaks production.** Expected: a failed migration stops the deploy; a deployment whose `/api/health` isn't 200 is never promoted; an older run never overwrites a newer one. Pinned in Task 6 (workflow logic, checked by `actionlint` and a dry run of the guard script).
4. **Neon compute exhausted by monitoring.** Expected: the uptime monitor never queries the database. Pinned in Task 4.
5. **Connection exhaustion on Vercel.** Expected: production refuses a Neon URL that isn't the pooled one, and idle clients are released before a function suspends. Pinned in Task 1.

---

### Task 1: Production database settings

**Files:** Modify `apps/web/src/server/config.ts`, `config.test.ts`, `src/server/db/client.ts`, `apps/web/.env.example`, `apps/web/package.json`; test `tests/support/config.ts`.

**Interfaces:** Produces `AppConfig.sentryDsn: string | null` (used by Tasks 2, 3, 5).

- [ ] Failing tests in `config.test.ts`: production with `DATABASE_URL=postgres://u:p@ep-x.ap-southeast-1.aws.neon.tech/db` fails with `DATABASE_URL: use Neon's pooled connection string (host contains -pooler) in production`; the same host with `-pooler` passes; a non-Neon host passes. `NEXT_PUBLIC_SENTRY_DSN` accepts `https://abc@o1.ingest.sentry.io/123`, rejects `http://...` and a URL with no project id, and maps to `sentryDsn`.
- [ ] Implement in the `superRefine` production block and the schema; add `sentryDsn: null` to `testConfig`.
- [ ] `createDb`: call `attachDatabasePool(pool)` from `@vercel/functions` so Fluid compute releases idle clients before suspending (no-op elsewhere).
- [ ] `.env.example`: document the pooled URL, `DATABASE_URL_UNPOOLED` (migrations and backups only, GitHub secret), `NEXT_PUBLIC_SENTRY_DSN`.
- [ ] Run `corepack pnpm --filter @vash/web test src/server/config.test.ts src/server/db`, commit.

### Task 2: Error reporting core (scrub, logger hook, Sentry init)

**Files:** Create `apps/web/src/lib/monitoring/scrub.ts` + test, `src/server/monitoring/sentry.ts`, `src/instrumentation-client.ts`; modify `src/server/logging.ts` + test, `src/instrumentation.ts`, `src/server/context.ts`.

**Interfaces:** Produces `scrubUrl(url: string): string`, `scrubText(text: string): string`, `scrubEvent<E>(event: E): E`, `scrubBreadcrumb<B>(crumb: B): B`; `createLogger(write?, now?, onError?: (err: unknown, tags: { event: string; requestId?: string }) => void)`; `reportError` and `withCronMonitor` in `server/monitoring/sentry.ts`.

- [ ] Failing tests for `scrubUrl`: query and fragment removed (`https://x.supabase.co/o/k.png?X-Amz-Signature=abc` → `https://x.supabase.co/o/k.png`), `/s/AbC123_-xyz` → `/s/:token`, `/api/shared/AbC/remix` → `/api/shared/:token/remix`, relative URLs keep their path, garbage stays garbage minus anything after `?`.
- [ ] Failing tests for `scrubText`: emails → `[email]`, `Failed query: select ... params: a@b.c` → `Failed query (SQL and parameters omitted)`, `postgres://u:pw@h` → `postgres://[redacted]@h`, URLs inside text lose query strings.
- [ ] Failing tests for `scrubEvent`: removes `user`, `request.cookies`, `request.headers`, `request.data`, `request.query_string`; scrubs `request.url`, `transaction`, `message`, every `exception.values[].value`, every breadcrumb's `message` and `data.url`/`data.from`/`data.to`.
- [ ] Logger: `error()` with an `err` field calls `onError(err, { event, requestId })` with the raw error; a throwing `onError` never breaks logging. Tests in `logging.test.ts`.
- [ ] `server/monitoring/sentry.ts`: `initServerSentry(dsn)` (no tracing, `sendDefaultPii: false`, `beforeSend: scrubEvent`, `beforeBreadcrumb: scrubBreadcrumb`, `environment: VERCEL_ENV ?? NODE_ENV`, `release: VERCEL_GIT_COMMIT_SHA`), `reportError`, `withCronMonitor`.
- [ ] `instrumentation.ts`: init when the DSN is set on the Node runtime; export `onRequestError` that forwards to `Sentry.captureRequestError` only when enabled. `instrumentation-client.ts`: same options plus `tunnel: "/api/monitoring"`, default integrations minus replay.
- [ ] `context.ts`: pass `reportError` as the logger's `onError` when `config.sentryDsn` is set.
- [ ] Tests, typecheck, commit.

### Task 3: Sentry tunnel `/api/monitoring`

**Files:** Create `src/server/monitoring/handlers.ts` + test, `src/app/api/monitoring/route.ts`; modify `src/server/context.ts`, `src/server/rate-limit/rules.ts` (or wherever `RATE_LIMITS` lives).

**Interfaces:** `monitoringHandlers(deps, forward: typeof fetch = fetch)` → `{ tunnel: Handler }`.

- [ ] Failing tests: 404 when Sentry is off; 403 cross-origin (kernel); 413 over 256 KB; 400 when the envelope header isn't JSON or has no `dsn`; 400 when the DSN host or project differs from ours; 200 and one forwarded POST to `https://<host>/api/<project>/envelope/` with the body untouched; 429 after the per-IP limit; upstream failure returns 502 without logging the body.
- [ ] Implement; wire route and context. Commit.

### Task 4: Liveness endpoint, cron monitor, error pages

**Files:** Modify `src/server/health/handlers.ts` + test, `src/server/cron/handlers.ts` + test, `src/server/context.ts`; create `src/app/api/health/live/route.ts`, `src/app/error.tsx`, `src/app/global-error.tsx`, `src/app/not-found.tsx`.

- [ ] Failing test: `GET /api/health/live` returns 200 `{ status: "ok" }` and never calls the database (a `db` whose every method throws).
- [ ] Failing test: `cronHandlers(deps, storage, secret, monitor)` runs cleanup inside `monitor`; when cleanup throws, `monitor` sees the rejection and the response is 500.
- [ ] Error pages: plain monochrome copy, a "Try again" button (`glass-primary`) and a link home; `error.tsx` and `global-error.tsx` report the error through `@sentry/nextjs` (`captureException`, a no-op when Sentry isn't initialised). Check in the browser in light and dark mode.
- [ ] Commit.

### Task 5: Owner tooling: first admin

**Files:** Create `apps/web/scripts/make-admin.ts`, `src/server/admin/promote.ts` + test; modify `package.json` (`admin:grant`).

- [ ] Failing test: `grantAdmin(db, email)` sets `role = 'admin'` for that email (case-insensitive), returns `"granted" | "already" | "missing"`, and writes an `admin_audit` row when that table exists in the schema.
- [ ] Script reads `DATABASE_URL` and one email argument, prints only the outcome. Commit.

### Task 6: Deploy pipeline

**Files:** Create `.github/workflows/deploy.yml`, `.github/scripts/is-latest-main.sh`; modify `apps/web/vercel.json`.

- [ ] `vercel.json`: `"regions": ["sin1"]` (next to Neon `ap-southeast-1`), `"git": { "deploymentEnabled": false }` (only the workflow deploys), keep the daily cron.
- [ ] `deploy.yml`: `workflow_run` on CI completed, plus `workflow_dispatch`. Guard: conclusion success, event `push`, head branch `main`, head repository is this repository. `concurrency: deploy-production` without cancelling. Environment `production`. Steps: check secrets present (skip with a notice when not set up yet), checkout `head_sha`, confirm it's still the tip of `main` (skip otherwise), install, `pnpm db:migrate` with `DATABASE_URL_UNPOOLED`, `vercel pull`, `vercel build --prod`, `vercel deploy --prebuilt --prod --skip-domain`, poll `<deployment>/api/health` with the automation bypass header until 200 (fail after about 2 minutes), `vercel promote`, then check `APP_ORIGIN/api/health`.
- [ ] Pin every action by SHA, `permissions: contents: read`, `persist-credentials: false`, pinned `vercel` CLI version. Validate with `actionlint`.
- [ ] Commit.

### Task 7: Encrypted daily backups

**Files:** Create `.github/workflows/backup.yml`, `docs/runbooks/restore.md`.

- [ ] Daily at 02:30 UTC plus manual: install the PostgreSQL 17 client, `pg_dump --format=custom` over `DATABASE_URL_UNPOOLED`, encrypt with `gpg --symmetric --cipher-algo AES256` using `BACKUP_PASSPHRASE`, upload as an artifact with 7-day retention. Skip with a notice when secrets are missing. Fail loudly otherwise (GitHub emails the owner).
- [ ] The plaintext dump never leaves the runner's temp directory and is deleted after encryption.
- [ ] Restore runbook: download, decrypt, `pg_restore` into a new Neon branch, check, then swap.
- [ ] Commit.

### Task 8: Docs, legal, decisions

**Files:** Create `docs/deploy.md`; modify `docs/free-stack.md`, `apps/web/src/app/privacy/page.tsx`, `docs/decisions.md`, `AGENTS.md`, `docs/legal/compliance-review.md` (processor list, if present).

- [ ] `docs/deploy.md`: one-time setup, in order: Neon (Singapore, pooled + direct URLs), Supabase buckets, Vercel project (root `apps/web`, env vars, Protection Bypass for Automation), Sentry (project, DSN, alert rule, cron monitor appears after the first run), UptimeRobot (HTTP(s) monitor on `/api/health/live`, 5 minutes, email alert), GitHub `production` environment (secrets and variables list, deployment branch rule `main`), first deploy, `pnpm admin:grant`. Day-2: rollback, restore, rotating secrets.
- [ ] Privacy: Sentry under "Who helps us run VASH", an "Error reports" bullet under what we collect (browser and OS, page path, error details; no email, cookies or photos), retention (Sentry keeps reports up to 30 days; encrypted database backups up to 7 days), update the date.
- [ ] free-stack.md: Sentry and UptimeRobot rows with limits; Hosting table notes on regions and the pooled URL.
- [ ] decisions.md rows for: GitHub-driven staged deploys, own Sentry tunnel, liveness endpoint without DB, no tracing or replay, source maps deferred.
- [ ] AGENTS.md: deploy section pointer, remove the stale `db:seed` gap line.
- [ ] Full `test`, `typecheck`, `lint`, `build`; open the PR.

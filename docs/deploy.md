# Deploying VASH

Production runs on free tiers only: Vercel Hobby (app), Neon (Postgres), Supabase (photos), Sentry (errors),
UptimeRobot (uptime), GitHub Actions (deploys and backups). After the one-time setup below, every merge to `main`
deploys itself.

## How a deploy works

`.github/workflows/deploy.yml` runs after CI passes on `main` (or by hand: Actions → Deploy → Run workflow):

1. Skips quietly if setup isn't finished, or if a newer commit has landed on `main` (that run deploys instead).
2. Applies database migrations over Neon's **direct** connection.
3. Builds with the Vercel CLI and creates a production deployment **without** pointing the domain at it.
4. Calls that deployment's `/api/health` (database included) until it answers 200, for up to 2 minutes.
5. Promotes it: the domain switches over with no downtime. Then checks the live site and loads seed templates.

If any step fails, the site keeps serving the previous deployment and GitHub emails you the failed run.

Because migrations run before the new code is live, each migration must work with the code already serving: add
columns and tables first, and remove old ones in a later release.

## One-time setup

Do these in order. Keep every secret in a password manager; never paste one into code, chat or an issue.

### 1. Neon (database)

1. neon.com → New project. Region: **AWS Asia Pacific (Singapore)**, the closest Neon region to India. Postgres 17.
2. Dashboard → Connect. Copy two strings:
   - the **pooled** one (host contains `-pooler`), for the app;
   - the **direct** one (pooling switched off), for migrations and backups.
   Both end in `?sslmode=require`. The app refuses a direct Neon string in production, because each serverless
   instance opens its own connections and the direct endpoint runs out.

### 2. Supabase (photos)

Follow the Supabase row in `docs/free-stack.md`: region **South Asia (Mumbai)**, buckets `vash-private` (private) and
`vash-public` (public), 15 MB limit, JPEG/PNG/WebP only, CORS allowing `PUT` and `GET` from your `APP_ORIGIN`.

### 3. Vercel (app)

1. vercel.com → Add New → Project → import `vamsikoneru06/layer`.
   - Root Directory: `apps/web`. Framework: Next.js. Leave build settings at their defaults.
   - Deploys come from GitHub Actions, not from Vercel's Git integration (`apps/web/vercel.json` turns it off).
2. The production address is `https://<project-name>.vercel.app`. That's your `APP_ORIGIN`.
3. Settings → Environment Variables, for **Production**:

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | Neon **pooled** string |
   | `APP_ORIGIN` | `https://<project-name>.vercel.app` |
   | `BETTER_AUTH_SECRET` | 32+ random characters (`openssl rand -base64 32`) |
   | `TRUST_PROXY` | `true` |
   | `CRON_SECRET` | another 32+ random characters |
   | `GMAIL_USER` and `GMAIL_APP_PASSWORD` | or `RESEND_API_KEY` and `MAIL_FROM` |
   | `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` | optional, see step 4 |
   | `STORAGE_*` | all seven, from Supabase (see `apps/web/.env.example`) |
   | `CONTACT_EMAIL` and `GRIEVANCE_OFFICER_NAME` | shown on the Terms and Privacy pages (required by Indian law) |
   | `NEXT_PUBLIC_SENTRY_DSN` | from step 5 |

4. Settings → Deployment Protection: keep **Standard Protection** and turn on **Protection Bypass for Automation**.
   Copy the generated secret: the deploy uses it to health-check a deployment before it goes live.
5. Account settings → Tokens → create a token for this deploy (scope it to your account, set an expiry, renew it when
   it ends). Note your **Team/Account ID** (Settings → General) and the **Project ID** (project Settings → General).

### 4. Google sign-in (optional)

Google Cloud console → APIs & Services → Credentials → your OAuth client → **Authorized redirect URIs**. Add one line
per address you run VASH on, exactly (scheme, host and port must match; `localhost` and `127.0.0.1` are different):

```text
https://<project-name>.vercel.app/api/auth/callback/google
http://localhost:3000/api/auth/callback/google
```

A missing or different line is what Google reports as `Error 400: redirect_uri_mismatch`. Changes can take a few
minutes to apply.

### 5. Sentry (error alerts)

1. sentry.io → sign up (Developer plan, free). Pick a data region (EU or US); it can't be changed later.
2. Create a project → platform **Next.js**. Copy the DSN (Settings → Client Keys) into Vercel as `NEXT_PUBLIC_SENTRY_DSN`.
3. Project Settings → Security & Privacy: keep **Data Scrubber** and **Use Default Scrubbers** on, and turn on
   **Prevent Storing of IP Addresses**. VASH also scrubs every report before sending it (emails, tokens, signed URLs,
   cookies, SQL parameters).
4. Alerts: the default "new issue" email alert is enough to start.
5. Crons: a monitor called `cleanup` appears after the first nightly run (03:00 UTC). Sentry then emails you if the
   cleanup fails or doesn't run.

Browser reports go through `/api/monitoring` on VASH's own domain, so the CSP needs no Sentry host.

### 6. GitHub (deploy and backup secrets)

Repository Settings → Environments → New environment `production`:

- Deployment branches and tags: **Selected branches** → `main`.
- Environment secrets:

  | Secret | Value |
  |---|---|
  | `VERCEL_TOKEN` | the token from step 3.5 |
  | `VERCEL_ORG_ID` | Team/Account ID |
  | `VERCEL_PROJECT_ID` | Project ID |
  | `VERCEL_AUTOMATION_BYPASS_SECRET` | from step 3.4 |
  | `DATABASE_URL_UNPOOLED` | Neon **direct** string |
  | `BACKUP_PASSPHRASE` | 32+ random characters; store it in your password manager too, or backups can't be opened |

- Environment variables: `APP_ORIGIN` = `https://<project-name>.vercel.app`.

### 7. First deploy

1. Actions → **Deploy** → Run workflow (branch `main`). Watch it go green.
2. Open the site, sign in once, then make yourself an admin from your computer:

   ```bash
   DATABASE_URL="<Neon direct string>" corepack pnpm admin:grant you@example.com
   ```

   Admin tools stay locked until you set up two-step verification: sign in again, then within 10 minutes open
   Settings → Two-step verification → Set up, with an authenticator app. Keep the backup codes somewhere safe. Each new
   device needs a code, and one code unlocks admin tools on that device for 12 hours.
3. Actions → **Backup** → Run workflow, and check it uploads an artifact.

### 8. UptimeRobot (is the site up?)

uptimerobot.com → free account → New monitor:

- Type **HTTP(s)**, URL `https://<project-name>.vercel.app/api/health/live`, interval **5 minutes**.
- Alert contact: your email.

Use `/api/health/live`, not `/api/health`. The live check doesn't touch the database, so Neon can still scale to zero
between visits. A check of `/api/health` every 5 minutes would keep Neon awake around the clock and use up the free
plan's 100 compute hours in about 17 days. Database failures still reach you: real requests that fail are reported
to Sentry.

## Day to day

- **Roll back:** Vercel → Deployments → pick the last good one → Instant Rollback. Then fix forward on `main`; the next
  deploy promotes itself.
- **Redeploy without a code change** (for example after changing an environment variable): Actions → Deploy → Run workflow.
- **Restore data:** `docs/runbooks/restore.md`.
- **Rotate a secret:** change it at the provider, update Vercel or the GitHub environment, then redeploy. Rotating
  `BETTER_AUTH_SECRET` signs everyone out.
- **Free-tier limits:** see `docs/free-stack.md`. Vercel Hobby is for personal, non-commercial use.

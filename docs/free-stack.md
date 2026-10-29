# VASH on a zero-rupee budget

Every service VASH depends on has a free tier that needs no card. Picked from
[public-apis](https://github.com/public-apis/public-apis) (Photography, Art & Design) plus Google.
Free limits change; check each provider's page when you sign up.

Keys go in `apps/web/.env.local` (git-ignored), never in code or chat.

## In the app now

| Service | What it does in VASH | Key? | Free limit |
|---|---|---|---|
| Google OAuth | "Continue with Google" on `/signin` | `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` | Free |
| Gmail SMTP | Sends magic sign-in links | `GMAIL_USER` + `GMAIL_APP_PASSWORD` | ~500 emails/day |
| Supabase Storage | Photo uploads (S3 API, presigned URLs) | `STORAGE_*` (S3 access keys) | 1 GB; no card. Create `vash-private` as a **private** bucket and `vash-public` as a public one; on both set a 15 MB file-size limit and allow only `image/jpeg`, `image/png`, `image/webp`. `STORAGE_PUBLIC_BASE_URL` must point at the public bucket (`https://<project>.supabase.co/storage/v1/object/public/vash-public`). CORS must allow `PUT` and `GET` from your `APP_ORIGIN`. Cloudflare R2 is free up to 10 GB but asks for a card |

| Sentry (Developer plan) | Error reports from the server and browser, cron monitor for the nightly cleanup | `NEXT_PUBLIC_SENTRY_DSN` (public DSN, not a secret) | 5,000 errors a month, 1 cron monitor, 1 user. Reports are scrubbed before sending and relayed through `/api/monitoring`. No tracing or session replay |
| UptimeRobot | Emails the owner when the site stops answering | No (set up in its dashboard) | 50 monitors, 5-minute checks. Point it at `/api/health/live`, which doesn't wake the database |

Without either, sign-in still works in development: the link is printed in the server log.

## Planned, by the screen that needs it

| Service | Screen | Key? | Free limit / terms |
|---|---|---|---|
| Pexels | Editor › Photos: free stock photo search | Yes (instant, pexels.com/api) | 200 req/hour, 20k/month; credit the photographer |
| Lorem Picsum | Landing mini-editor: "Try with sample photos" | No | Free |
| Iconify | Editor › Stickers: 200k+ open-source icons and emoji | No | Free; license varies per icon set |
| Google Fonts | Editor › Text: font picker | No (files are free) | Free |
| Google Photos Picker | Media: import from Google Photos | Same Google OAuth client | Free; Google may review the app before public launch |

Considered and left out: Unsplash (50 req/hour until approved), Pixabay (must re-host every image),
remove.bg / PhotoRoom (tiny free quota, then paid), Getty / Shutterstock (paid), Kavel (AI generation is out of scope),
Colormind (HTTP only), Quotable (unreliable uptime).

## Hosting

| Need | Free option | Note |
|---|---|---|
| Web app | Vercel Hobby | Personal, non-commercial use only. Functions in Singapore (`sin1`, next to Neon); one cron run a day |
| Postgres | Neon free | 0.5 GB, 100 compute hours a month, scales to zero after 5 idle minutes; no card. Singapore region (no Mumbai). The app uses the pooled string; migrations and backups the direct one |
| Deploys and backups | GitHub Actions | Free for public repositories. `deploy.yml` and `backup.yml`; setup in `docs/deploy.md` |
| Local dev database | PGlite (`npx @electric-sql/pglite-socket`) | No Docker needed |

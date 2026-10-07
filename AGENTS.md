# AGENTS.md

Instructions for AI coding agents (and people) working on **VASH**, a template-first photo design editor in the
browser: pick a template, drop in photos, edit text, shapes and filters, export a PNG.

Read this file first. The full product spec is `docs/superpowers/specs/2026-09-24-vash-design.md`.

## Hard rules

### Money
- **Everything must be free.** No paid services, no trials that need a card. Use free tiers only.
  `docs/free-stack.md` lists the chosen services and their limits. Ask the owner before adding any new service.

### Secrets
- Keys live **only** in `apps/web/.env.local` (git-ignored). Never commit them, print them, paste them into
  code, logs, tests, docs or chat, or copy `.env.local` anywhere. `apps/web/.env.example` documents every variable.
- CI runs gitleaks, CodeQL, `pnpm audit` and dependency review. A leaked key fails the build.

### Design rules (from the owner; these override any mockup or component you copy)
Do NOT use:
1. Purple gradients
2. Vague hero text
3. Fake counters
4. Fake reviews or testimonials
5. Lots of scroll animations
6. Pill-shaped buttons (use rounded rectangles: `rounded-lg`, `rounded-xl`; the shared button radius is 12px)
7. Emoji icons (use `lucide-react`)
8. Fake metrics or invented numbers
9. Cursor animations
10. AI-generated images
11. A "Made with AI" tag
12. Em dashes in anything a user reads (use a period, comma or colon)
13. Generic AI-sounding copy: write plain, specific, honest text

Do use: the site favicon (`apps/web/src/app/icon.png`), and keep the Terms (`/terms`) and Privacy (`/privacy`)
pages accurate when data handling changes.

Copy must be true. Example: guests can create, edit and export designs (kept in the browser, `lib/local-designs.ts`), but uploading photos and keeping designs across devices need an account, so never claim "everything works without an account".

The look is "Liquid Glass" and monochrome: colour tokens in `apps/web/src/app/globals.css` (`--bg`, `--text`,
`--muted`, `--line`, `--field`, `--seg`...), light and dark mode, glass classes (`glass-btn`, `glass-primary`,
`glass-secondary`). Reuse `components/ui/*` and `components/editor/fields.tsx` before writing new controls.

### Security
- Every API resource is owner-scoped; keep the cross-user tests passing (`apps/web/src/server/**`).
- CSP is strict (`apps/web/src/proxy.ts`, `server/security/headers.ts`): scripts need the per-request nonce,
  `img-src 'self' blob: data:` plus the storage origins, `font-src 'self'`. Self-host fonts and images; don't
  add third-party script, font or image hosts.
- Documents never contain URLs: assets are referenced by id and resolved to short-lived signed URLs by the API.

### Legal
- `/terms` and `/privacy` must stay true. Any change to what data is collected, where it's stored, which services
  process it, cookies, or who can see content must update those pages in the same PR.
- Indian law applies (IT Act 2000, IT Rules 2021, DPDP Act 2023, CERT-In Directions). The review and open items are in
  `docs/legal/compliance-review.md`; the breach plan is `docs/legal/incident-response.md`.
- Users must be 18 or older. Features that make content public need a way to report it.

## Stack and layout

pnpm monorepo (pnpm 12 via corepack, Node 24+), TypeScript everywhere.

| Path | What |
|---|---|
| `apps/web` | Next.js 16 (App Router, Turbopack), React 19, Tailwind v4, Better Auth (magic link + Google), Drizzle + Postgres |
| `apps/web/src/app` | Routes. `(app)/` = signed-in shell (Home, Designs); `edit/[id]` = editor; `dev/*` = development-only pages |
| `apps/web/src/components` | UI: `app/` (shell, side bar), `designs/`, `editor/` (workspace, panels, fields), `ui/`, `legal/` |
| `apps/web/src/server` | API handlers, services, repositories, auth, storage (S3 API), rate limits, cron |
| `apps/web/templates` | The 49 seed templates (`seed-templates.ts` is the source; run `templates:build` to regenerate the JSON) |
| `packages/schema` (`@vash/schema`) | Document format, validator, migrations, limits, font allowlist |
| `packages/engine` (`@vash/engine`) | The editor engine: pure TypeScript, zero runtime dependencies |

### Engine conventions
- A node's `transform.x/y` is its **centre**; local matrix = translate · rotate · scale. Group children are
  relative to the group centre.
- Documents are immutable. Every edit is a `Command` through `EditorCore.dispatch` (one undo step) or a
  transaction (`beginTransaction` / `preview` / `commitTransaction`) for drags and slider drags.
- The lock policy (`policy.ts`) is enforced in the engine, not just hidden in the UI.
- Rendering is Canvas2D (scene canvas + overlay canvas); photo filters are WebGL2 (`filters.ts`).
- The editor redraws on `requestAnimationFrame`, so a hidden browser tab or pane draws nothing. For automated
  checks, use `editor.exportPng()` or DOM state rather than screenshots.

## Commands

```bash
corepack pnpm install
corepack pnpm -r test                    # all unit + integration tests (schema, engine, web)
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm --filter @vash/web dev     # http://localhost:3000
corepack pnpm --filter @vash/web fonts:sync        # after changing the font allowlist
corepack pnpm --filter @vash/web templates:build   # after editing seed templates
```

Local database without installing Postgres (in-memory, wiped when it stops):

```bash
npx -y -p @electric-sql/pglite-socket@0.2.11 -p @electric-sql/pglite pglite-server --db=memory:// --port=5433 --max-connections=10
```

Then set `DATABASE_URL=postgres://postgres@127.0.0.1:5433/postgres` and run `corepack pnpm db:migrate`.
In development, sign-in links are printed in the server log when no mail keys are set.

`corepack pnpm db:seed` loads the seed templates and sample photos (idempotent).

Production: `docs/deploy.md` (one-time setup, how deploys work, rollback); restores: `docs/runbooks/restore.md`.
Deploys run from `.github/workflows/deploy.yml` after CI on `main`, so every migration must work with the code
already serving (add first, remove in a later release). Errors go to Sentry only when `NEXT_PUBLIC_SENTRY_DSN` is set;
never log or report tokens, signed URLs or emails (`src/lib/monitoring/scrub.ts` does this for Sentry).

## Workflow

- Branch from `main` for each piece of work; never commit to `main` directly.
- Before a PR: `corepack pnpm -r test`, `corepack pnpm typecheck` and `corepack pnpm lint` all pass.
- Open a PR; merge (squash) only when CI is green.
- Match the surrounding code: comment density, naming, small focused files. Change only what the task needs.
- Check UI changes in a real browser, in light and dark mode, and at phone width (the editor itself needs
  1024 px or wider; smaller screens get a notice).

## What's next

1. **Photos in the editor** (M2 Task 5, `docs/superpowers/plans/2026-09-27-p1-editor-m2.md`): resolve asset ids
   to signed URLs, decode once with `createImageBitmap` (≤ 2048 px working copy), drop a file onto a frame to
   upload and place it, Photos panel with the user's media and Pexels search (`PEXELS_API_KEY`, credit the
   photographer). The storage backend exists (`apps/web/src/server/storage`, `server/assets`,
   `docs/superpowers/plans/2026-09-26-storage-and-uploads.md`). In development uploads work without setup: with no `STORAGE_*` keys, photos are
   stored in the database (`src/server/storage/database.ts`, 50 MB per user). Production requires the Supabase keys
   (Vercel caps request bodies near 4.5 MB and the free database is 0.5 GB in total).
2. **Missing pages** linked from the side bar: `/media`, `/templates`, `/settings`. Account export and deletion
   already exist as API endpoints (`apps/web/src/server/me`); Settings needs the UI.
3. **Later phases** (spec §2.3): Author Mode, publishing, share links, creator profiles, moderation.
4. **Owner decisions pending:** the public `CONTACT_EMAIL` for the legal pages, and a custom domain (costs money
   unless a free source is found; the free fallback is a `vercel.app` address).

# VASH roadmap

Where VASH stands, what it is for, and what to build next, in order. Written 2026-10-03 from an outside product
review and a backend engineering checklist, both checked against the code on `main` (db80467, which includes #23 to #25).
The full spec stays in `docs/superpowers/specs/2026-09-24-vash-design.md`; this file decides the order.

Every item must fit `docs/free-stack.md`. Anything that needs a new service is marked **owner decision**.

## 1. Where we are

| Area | State | Evidence |
|---|---|---|
| Document format, validator, migrations | Done | `packages/schema` |
| Editor engine: commands, undo, transforms, snapping, text, filters (WebGL2), PNG export | Done | `packages/engine` |
| Accounts: magic link + Google, sessions, settings, export and delete account | Done | `server/auth`, `server/me`, `/settings` |
| Designs: save, folders, duplicate, autosave with conflict handling | Done | `server/designs`, `lib/autosave.ts` |
| Template gallery and template detail pages, "Use template" | Done (#13, #20) | `/templates`, `/templates/[id]` |
| Photo uploads, Media page | Done (#11, #20); works without Supabase keys (#24) | `server/assets`, `/media` |
| Photos visible in editor and previews, 36 templates with sample photos | Done (#24) | `lib/images.ts`, `templates/seed` |
| Hidden-template photo fix, storage deletion backoff | Done (#23) | `server/storage/outbox.ts` |
| Share links, remix, profiles, reports, moderation API | Done (#25), API only, no UI yet | `server/shares`, `server/admin` |
| Exact hit testing for polygons, paths, rounded corners | Done in this PR | `packages/engine/src/outline.ts` |
| sitemap.xml and robots.txt | Done in this PR | `server/seo` |
| Guest mode (edit and export without an account) | **Not started.** The spec promises it; the code sends guests to sign in | `components/designs/use-create-design.ts:19` |

The outside review was written against an older local checkout, so it missed #18 to #22. Its main point still
holds: **the spec's first-use promise (landing to exported PNG in under 2 minutes, no sign-up) is not true yet.**
Until it is, no page may say "no sign-up needed" (AGENTS.md design rules).

## 2. What VASH is for

**Design once, get the whole set.** Someone enters their photos and details once. VASH lays them out so the
important parts stay readable, then gives them the matching post, story, thumbnail and flyer, and lets them come
back next week to change the date without starting over.

Who it is for, by the jobs they repeat:

- **Small businesses:** menus, price lists, weekly specials, opening hours, sale and launch posts.
- **Events and communities:** invitations, schedules, speaker cards, announcements, fundraiser updates.
- **Creators and teachers:** lesson cards, quote cards, thumbnails, reading lists.
- **Personal:** birthdays, weddings, travel recaps, photo collages.

What we will not promise: "more templates than Canva". A solo, free project can't win on count. It can win on
**useful variations of recurring jobs**, which recipes (milestone 5) make cheap to produce.

## 3. Milestones

Each milestone ends with something a user can do that they couldn't before. Do them in order; within a
milestone, the list is in order too.

### M0. Land what's already built
1. #23, #24 and #25 are merged.
2. This branch (roadmap, sitemap, hit testing, timeouts).
3. Refresh AGENTS.md "What's next" to point at this roadmap.

### M1. The first result, without an account
Goal: landing page to exported PNG with your own photos, no sign-up, as spec §1 and flow 1 describe.
1. **Guest designs in IndexedDB:** `useCreateDesign` and "Use template" create a local design for guests;
   autosave writes to IndexedDB instead of the API. One storage interface, two backends.
2. **Guest photos stay on the device:** dropped files are stored as Blobs in IndexedDB and resolved to `blob:` URLs
   (already allowed by the CSP). Nothing is uploaded until the user signs in.
3. **Export works for guests** (it already runs in the browser).
4. **Save to cloud:** on sign-in, upload local photos through the existing upload flow, create the designs, then
   clear local copies. Idempotent, so a refresh halfway through doesn't duplicate anything.
5. **Copy and legal:** update AGENTS.md ("needs sign-in"), the landing page, Terms and Privacy (photos stay on
   the device until you save; "Clear this device" button).

### M2. Templates people can find
1. **Server-rendered template pages** with the template's title, description and preview in `<title>`,
   meta description and Open Graph tags (right now every detail page is titled "Template · VASH", which wastes the sitemap).
2. **Task-based categories** matching section 2 (menus, weekly specials, invitations...), with search by job.
3. **Landing demo that works:** "Try it with sample photos" opens a real template in the guest editor (Lorem Picsum
   is in the free stack, but the bundled Pexels samples from #24 are better: no third-party image host).
4. **Public template pages cached at the CDN** (`s-maxage`), like the sitemap, so search traffic doesn't hit the database.

### M3. Photo editing you can rely on
1. Replace and crop a photo inside its frame (pan and zoom within the frame).
2. Clear states: photo missing, upload failed (retry), over quota (the real limit, already in #24).
3. Photos panel: your media plus Pexels search with photographer credit (`PEXELS_API_KEY`, free).

### M4. Coming back next week
1. **Brand kit:** saved colours, fonts and logo per account, applied to any template in one step.
2. **Make the set:** from one design, generate the other formats (post, story, thumbnail, flyer) using
   layout constraints, so text stays readable and photos stay in frame.
3. **Recurring fields:** mark text as "date", "price", "venue"; update them across the whole set at once.

### M5. Recipes: variety without hand-drawing every template
A template becomes a recipe: editable fields, photo slots, layout constraints, font pairings, colour themes and
supported formats. VASH generates checked variations (1 to 4 photos, portrait or landscape, short or long text,
light or dark) and only offers the ones that pass validation (text fits, nothing off the canvas, contrast OK).
Authors contribute recipes through Author Mode, with the licensing, attribution, reporting and moderation from #25.

### M6. Engine polish users will notice
1. Text-fit feedback: show when text is shrunk or cut by `maxChars`, while typing.
2. Performance budget: measure big templates in `/dev/bench` and keep a frame under 16 ms on a mid-range laptop.
3. Accessibility pass on the editor (keyboard layer moves, focus order, labels).

## 4. Backend engineering checklist, applied to VASH

The checklist has 17 levels. VASH is one Next.js app on Vercel with one Postgres, run by one person on free
tiers. That fits levels 1 to 5 and parts of 8 to 10. The rest would add cost and moving parts without helping a
user, so we use what those levels teach (timeouts, idempotency, outbox) without the infrastructure.

| Level | What VASH already has | Added now | Next, and free | Skip, and why |
|---|---|---|---|---|
| 1. Basic backend | REST route handlers, Drizzle + Postgres, zod validation, problem+json errors, presigned uploads, same-origin only (no CORS needed) | | API reference generated from the zod schemas (OpenAPI) | |
| 2. Application architecture | handlers / service / repository layers, zod DTOs, `Deps` injection, transactions, optimistic locking on `designs.version`, drizzle-kit migrations, composite and GIN indexes, unique and check constraints | | Run `EXPLAIN ANALYZE` on gallery, resolve and quota queries with 10k rows; record results in `decisions.md` | |
| 3. Security | Sessions (not JWT, deliberately: revocable), magic link + Google OAuth, admin role checked per request, owner-scoped queries with cross-user tests, nonce CSP, HSTS, `frame-ancestors 'none'`, origin check against CSRF, rate limits, file-signature checks, no URLs in documents | **`docs/threat-model.md`** | Passkeys or Google-only sign-in for admins; secret rotation runbook | Policy engines, ABAC, org/team permissions: no teams yet |
| 4. Performance | Keyset (cursor) pagination, GIN full-text search, batched photo lookups and decode-once images (#24), `/dev/bench` | Sitemap served with `s-maxage` (CDN cache) | CDN caching for public gallery reads; image sizes per use | Redis: a new service (Upstash has a free tier, but **owner decision**); CDN headers and Postgres cover current load |
| 5. Async | Outbox table for storage deletions, worked by the daily cron, with retries and backoff (#23); idempotent seeding | | Same outbox pattern for thumbnails and guest-to-account migration | Kafka, RabbitMQ, SQS: paid or a new service for a queue Postgres already handles |
| 6. Distributed systems | Stateless functions; rate limits in Postgres so every instance shares them | | | Replication, sharding, consensus: one free database is far from its limits |
| 7. Microservices | | | | One app is the right size; splitting adds network failure modes for nothing |
| 8. Reliability | Health check (`/api/health`), autosave backoff on 429/5xx (#24), deletion backoff (#23), graceful fallbacks (database storage without Supabase, console mail without keys) | **DB connect 5 s and query 15 s timeouts; S3 connect 5 s and request 20 s timeouts** | Restore drill for Neon and Supabase, written down | Failover regions, circuit breakers between services: no services to break between |
| 9. Observability | Structured JSON logs per request with request id, path, status, duration, user id; `x-request-id` on responses | | `Server-Timing` header for DB time; Vercel's built-in logs and analytics | OpenTelemetry export, Sentry, Grafana Cloud: free tiers exist, each is a new service (**owner decision**) |
| 10. Cloud | Vercel, Neon, Supabase; secrets only in env; least privilege: storage keys never reach the browser | | Document which key can do what | AWS (EC2, ECS, VPC): costs money and replaces nothing we lack |
| 11. Kubernetes | | | | Vercel runs the app; nothing to orchestrate |
| 12 to 14. Database internals, advanced architecture, Kafka internals | Outbox, CAS versioning, GIN | | Read Postgres `EXPLAIN` output for our own queries (level 2 item) | Event sourcing, CQRS, sagas: nothing in VASH needs them |
| 15 to 17. Systems internals, build your own, consensus | | | | Learning topics, not product work. The engine (`packages/engine`, zero dependencies) is a good place to practise data structures and performance |

## 5. Done in this branch
- `docs/roadmap.md` (this file) and `docs/threat-model.md`.
- `/sitemap.xml` (public pages plus every published template, never hidden ones) and `/robots.txt`
  (keeps crawlers out of `/api`, `/edit`, `/dev` and signed-in screens).
- Exact hit testing for polygons, SVG paths (lines, curves, arcs) and rounded rectangles, with a pad for thin shapes.
- Timeouts on database and storage calls.

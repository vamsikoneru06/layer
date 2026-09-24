# Layer — Product Requirements & Design Spec

| | |
|---|---|
| **Status** | Draft v1 — sections 1–4 approved in brainstorming; sections 5–7 decided on the author's instruction to proceed ("build the backend with all the securities, CI/CD…") and open for review |
| **Date** | 2026-09-24 |
| **Owner** | Vamsi (solo) |
| **Decision log** | [`docs/decisions.md`](../../decisions.md) |
| **Frontend design brief** | [`docs/frontend-design-brief.md`](../../frontend-design-brief.md) (self-contained, for Claude Design) |

---

## 1. Overview

### 1.1 Problem
People who need a quick, good-looking social post, story, poster, thumbnail, or invitation either fight a blank canvas or use a closed tool. Templates solve the blank-canvas problem only if *dropping your own photos in* is effortless and the layout doesn't break when you do.

### 1.2 Product
**Layer** is a template-first photo design editor in the browser. Users pick a template, drop their photos into its frames, edit text/stickers/filters, and export a PNG. Creators design templates in the same app (Author Mode) and publish them to a public gallery.

### 1.3 Audiences
| Audience | Need |
|---|---|
| **Everyday creators** (students, small shops, event hosts) | A finished, on-brand image in < 5 minutes, no account required |
| **Template authors** | A real design tool with lockable, placeholder-aware templates and a gallery to publish into |
| **Admins** | Keep the gallery clean: handle reports, hide/feature templates |
| **Project goal (meta)** | A portfolio piece for product-company interviews: live demo, measurable performance, every hard part hand-built and explainable |

### 1.4 Success criteria
- A guest can go from landing page → exported PNG with their own photos in **under 2 minutes**, without signing up.
- Editor holds **60 fps** (≤ 16 ms/frame) while dragging, with 150 layers and 10 filtered photos, on a mid-range laptop.
- Filter slider preview updates within one frame at on-screen resolution.
- Export of a 1080×1920 design at 2× completes in **≤ 1.5 s**.
- Zero high/critical findings from CodeQL, `pnpm audit`, and gitleaks on `main`.
- Every API resource is owner-scoped, with automated tests proving cross-user access fails.

---

## 2. Scope

### 2.1 In scope (v1)
Template gallery → use template → drop photos into frames → edit (transform, text, shapes, stickers, WebGL filters) → PNG export; guest mode with local autosave; accounts with cloud save; media library; Author Mode; publish-to-gallery with privacy scrub; share links + remix; creator profiles; reporting + moderation.

### 2.2 Out of scope (v1)
Video/animation/MP4; multi-page designs (carousels); mixed styles within one text layer; real-time multi-user editing; mobile phone editor (editor requires ≥ 1024 px viewport; smaller screens get view/export only); payments; AI generation; background removal.

### 2.3 Phases
| Phase | Deliverable | Pages |
|---|---|---|
| **P0 Foundations** | Monorepo, schema package, **backend + security + CI/CD** | — (API only) |
| **P1 Working product** | Engine + editor; seed templates; guest mode | Editor, Gallery, Template Detail, Dashboard, My Designs |
| **P2 Creator side** | Accounts in the UI, media library, Author Mode | Author Mode, Media Library, Sign in, Onboarding, Settings |
| **P3 Community** | Publish, share, moderate, marketing | Publish Flow, Creator Profile, Shared View, Moderation, Landing |

Each phase ends demo-able.

---

## 3. Key user journeys

1. **Guest quick edit:** Landing → Gallery (filter "Instagram post") → Template Detail → *Use template* → Editor (guest) → drop 3 photos (fills placeholders in reading order) → edit headline → apply "Warm" filter → Export 2× PNG. Design autosaves to IndexedDB.
2. **Guest → account:** Guest clicks *Save to cloud* → Sign in (Google or magic link) → local designs + photos migrate to the account → Dashboard.
3. **Author publishes:** Dashboard → *New template* (size preset) → Author Mode → mark frames as placeholders, lock layout → *Preview as user* → Publish Flow (details → privacy scrub → thumbnail → preview → submit) → template live in Gallery and on Creator Profile.
4. **Share & remix:** Owner creates a share link → recipient opens Shared View (read-only) → *Remix* → signs in → a copy (with copied photos) lands in their Designs.
5. **Moderation:** User reports a template → Moderation queue → admin hides it → action written to the audit log.

---

## 4. Pages (15)

| # | Page | Route | Phase | Auth |
|---|---|---|---|---|
| 1 | Landing | `/` | P3 | public |
| 2 | Template Gallery | `/templates` | P1 | public |
| 3 | Template Detail | `/templates/[id]` | P1 | public |
| 4 | Shared Design View | `/s/[token]` | P3 | public (token) |
| 5 | Creator Profile | `/u/[handle]` | P3 | public |
| 6 | Sign in / Sign up | `/signin` | P2 | public |
| 7 | Onboarding | `/onboarding` | P2 | user |
| 8 | Settings | `/settings` | P2 | user |
| 9 | Dashboard | `/home` | P1 | guest or user |
| 10 | My Designs | `/designs` | P1 | guest or user |
| 11 | Media Library | `/media` | P2 | user |
| 12 | Editor | `/edit/[id]` | P1 | guest or user |
| 13 | Author Mode | `/author/[id]` | P2 | user |
| 14 | Publish Flow | `/publish/[designId]` | P3 | user |
| 15 | Moderation | `/admin/moderation` | P3 | admin |

Plus: 404, 500, empty states, and the "editor needs a larger screen" state. Detailed page specs live in the frontend design brief.

---

## 5. Architecture

pnpm monorepo:

```
layer/
├─ apps/web/            Next.js 16 (App Router): pages, route handlers (API), auth
├─ packages/schema/     Document types, hand-written validator, migrations, limits — shared by browser and server
├─ packages/engine/     Editor core: pure TypeScript, zero dependencies, no React   (P1)
└─ packages/ui/         From-scratch React component library                         (P1)
```

- **Engine ↔ React boundary:** `createEditor(canvas, doc)`; panels read via `useSyncExternalStore` selectors; all mutations go through `editor.dispatch(command)`. Rendering is dirty-flag driven on `requestAnimationFrame`.
- **Persistence:** guest → IndexedDB (docs + photo Blobs); user → API autosave debounced 1.5 s with optimistic concurrency (`version`); guest designs migrate on sign-in.
- **Uploads:** browser → object storage directly via presigned PUT; the server never proxies image bytes.
- **Hosting:** Vercel (app), Neon (Postgres), Cloudflare R2 (S3-compatible storage, two buckets: private + public).
- **Server layering (apps/web/src/server):** `routes` (thin Next route handlers) → `services` (business rules, authorization) → `repositories` (Drizzle queries). Services receive dependencies (db, storage, clock, mailer, current user) explicitly, so they are unit/integration-testable without Next.

### 5.1 From-scratch boundary
| Built from scratch | Used as foundations |
|---|---|
| Engine (scene graph, matrices, hit-testing, snapping, text layout, Canvas2D renderer, WebGL2 filter shaders, export), UI components, template format + validator + migrations, SVG path validator, rate limiter, publish privacy scrub, file-signature sniffing | React/Next.js, Tailwind CSS v4, Postgres + Drizzle ORM, Better Auth, Zod (API request DTOs only), AWS S3 SDK (R2), Google Fonts |

---

## 6. Document & template format

```ts
type Doc = {
  schemaVersion: 1;
  id: string;
  kind: "design" | "template";
  meta: { title: string; category?: string; tags?: string[]; format?: FormatKey };
  artboard: { width: number; height: number; background: Fill };
  root: NodeId[];                  // top-level layers, bottom → top
  nodes: Record<NodeId, Node>;     // flat, normalized
  assets: Record<AssetId, AssetRef>;
};
```

- **Node types:** `frame` (shape + optional `content {assetId, offsetX, offsetY, scale}` + `filters` + `placeholder`), `text` (single style per layer, `fit: none|shrink`, optional `maxChars`), `shape` (rect/ellipse/polygon/path + fill/stroke), `sticker` (`assetId`), `group` (`children`). Shared: `id, name, transform {x, y, rotation, scaleX, scaleY}, width, height, opacity, visible, lock`.
- **Every photo lives in a frame.**
- **Filters are parameters, never baked pixels:** `{ preset?, brightness, contrast, saturation, warmth, tint, highlights, shadows, vignette, grain, blur, sharpen }`, each in [−1, 1] (blur/sharpen/vignette/grain in [0, 1]).
- **Locks:** `free | content-only | locked` — guardrails, not security; users can unlock via an undoable command.
- **Assets are referenced by ID only — the document never contains a URL.** `AssetRef = { id, kind: "photo" | "sticker", mime, width, height }`. Clients resolve IDs to short-lived URLs through the API. This removes hot-linking, tracking pixels, and SSRF-style abuse from the format entirely. *(Refinement of the Section 2 decision, made while designing the backend.)*
- **Fonts:** `{ family, weight, style }` from an allowlist of Google Fonts families.
- **Units:** artboard pixels; rotation about node centre; export scale multiplies.
- **Versioning:** `schemaVersion` + ordered migration functions; the same validator runs in the browser (on load) and on the server (on save/publish), returning path-specific errors (`nodes.abc.transform.rotation: expected finite number`).
- **Limits:** designs ≤ 500 nodes, templates ≤ 150 nodes, serialized doc ≤ 1 MB, artboard 16–8192 px per side, text content ≤ 5,000 chars, tags ≤ 10 × 32 chars, path data ≤ 20 KB per node.
- **v1 cuts:** single text style per layer; single page per design (multi-page arrives as a v1→v2 migration).

### 6.1 Format presets
| Key | Size (px) |
|---|---|
| `ig-post` | 1080 × 1080 |
| `ig-story` | 1080 × 1920 |
| `yt-thumbnail` | 1280 × 720 |
| `poster` | 1240 × 1754 |
| `invitation` | 1500 × 2100 |
| `custom` | 16–8192 each side |

---

## 7. Editor engine (packages/engine, P1)

| Module | Responsibility |
|---|---|
| `math` | 2D affine matrices, vectors, AABB/OBB; world = parent × local (T·R·S about centre); cached, invalidated on change |
| `scene` | Immutable doc store with structural sharing; selectors |
| `commands` | `apply(doc) → { doc, inverse }`; transactions (begin/update/commit) coalesce a drag into one undo step; 200-step history |
| `interaction` | Pointer state machine: idle → hover → press → drag (move / resize / rotate / marquee / pan-inside-frame); Shift = keep ratio, Alt = from centre |
| `hit-test` | Top→bottom; pointer mapped into node-local space via inverse world matrix; exact shape test. Linear scan (≤ 150 nodes ≪ 1 ms) — no spatial index until measurements demand one |
| `snapping` | Edges/centres of artboard and other layers; sorted guide lines + binary search per axis; 6 *screen* px threshold |
| `text` | Word measurement, greedy wrap, long-word breaking, alignment, line height; **shrink-to-fit by binary search on font size**; layout cache; DOM overlay (`<textarea>` positioned by CSS `matrix()`) for typing, IME, selection |
| `render` | Canvas2D; DPR-aware; viewport zoom/pan; frames via `clip(Path2D)`; separate overlay canvas for selection/guides; dirty flags |
| `filters` | WebGL2 on OffscreenCanvas: one uber-shader pass for colour adjustments + vignette + grain; separable Gaussian blur and unsharp-mask passes (ping-pong FBOs); presets = parameter sets; preview at on-screen resolution, full-res on export; cache keyed by (asset, filter hash, resolution); `webglcontextlost` recovery; no-WebGL2 fallback shows unfiltered + notice |
| `images` | `createImageBitmap` decode once; ≤ 2048 px working copy; originals kept for export |
| `export` | Re-render to OffscreenCanvas at 1×/2×/3×; await `document.fonts` + full-res filters; `convertToBlob('image/png')`; 8192 px cap with friendly error; also produces thumbnails |
| `policy` | Mode-aware command filter: in `design` mode, commands violating `lock` are rejected by the engine (not just hidden in UI) |

---

## 8. Template system

### 8.1 Author Mode
Same engine in `author` mode. Author panel: template details (title, format, category, tags), per-layer lock level, placeholder toggle for frames, text rules (`maxChars`, `fit`). *Preview as user* switches to `design` mode with the policy applied. A **pre-save lint** blocks saving when: no placeholder frame and no editable text; a non-placeholder frame is empty; fonts outside the allowlist; unresolved asset references; node or size limits exceeded. Template drafts are stored as designs with `doc.kind = "template"`.

### 8.2 Using a template
*Use this template* **copies** the current template version into a new design (`sourceTemplateId`, `sourceTemplateVersion` recorded). Dropping a photo highlights the frame under the pointer (frames-only hit-test) and auto-fits "cover". Double-click pans/zooms inside the frame. Dragging a photo from one frame onto another swaps them. Dropping N photos fills placeholders in reading order (sort by top, then left). Signed-in uses are counted once per user per template per UTC day.

### 8.3 Seed templates
20 templates across the 5 formats, authored in Author Mode, committed as JSON in `apps/web/templates/seed/`, validated and visually regression-tested in CI, loaded by `pnpm db:seed`.

### 8.4 Publishing
1. **Details:** title, category, tags, description.
2. **Privacy scrub:** every frame holding the author's photo defaults to *replace with placeholder*; keeping a photo requires ticking "I own this image and allow reuse." Text layers are scanned for emails and phone numbers (warning, not block).
3. **Thumbnail:** rendered client-side via the export path, uploaded as an asset of kind `thumbnail`.
4. **Preview as user**, then submit.
5. **Server checks:** schema validation; template lint; every referenced asset is the author's own ready asset (or seed/public); kept photos are copied from the private bucket to the public bucket; PII warnings returned; rate limit 5/day.
6. **Moderation:** templates go live immediately; reports feed the admin queue; admins hide/restore/feature; every admin action is written to `audit_log`. Republishing creates a new version; existing designs keep their copies.

---

## 9. Backend (P0)

### 9.1 Stack
Next.js 16 route handlers on Node runtime · Drizzle ORM · Postgres (Neon in prod; **PGlite — Postgres compiled to WASM — in tests**, so the full suite runs without Docker) · Better Auth (Google OAuth + email magic link, DB sessions) · Zod for request DTOs · AWS SDK v3 against Cloudflare R2 · Resend HTTP API for email (console mailer in development).

### 9.2 Data model
| Table | Key columns | Notes |
|---|---|---|
| `user` / `session` / `account` / `verification` | Better Auth core | `user` extended with `handle` (unique, nullable until onboarding), `role` (`user`\|`admin`), `interests text[]`, `onboarded_at` |
| `folders` | `id, owner_id, name` | Owner-scoped |
| `designs` | `id, owner_id, folder_id, title, doc jsonb, version int, source_template_id, source_template_version, thumbnail_asset_id, timestamps` | `version` for optimistic concurrency |
| `assets` | `id, owner_id (null = system), kind (photo\|thumbnail\|sticker), visibility (private\|public), status (pending\|ready), storage_key, mime, bytes, width, height` | Storage keys are server-generated (`u/{userId}/{assetId}`); user filenames never used |
| `templates` | `id, author_id, title, description, category, tags text[], format, width, height, status (published\|hidden), featured, current_version, uses_count, timestamps` | GIN full-text index on title + tags |
| `template_versions` | `(template_id, version), doc jsonb, thumbnail_asset_id` | Immutable |
| `template_uses` | `(template_id, user_id, day)` | Dedupe key for usage counts |
| `reports` | `id, template_id, reporter_id, reason, note, status, resolved_by, resolved_at` | `unique(template_id, reporter_id)` |
| `share_links` | `id, design_id, token_hash, created_by, created_at, revoked_at` | Only the SHA-256 of the token is stored |
| `audit_log` | `id, actor_id, action, target_type, target_id, meta jsonb, created_at` | Append-only |
| `rate_limits` | `(key, window_start), count` | Fixed-window counters |
| `storage_deletions` | `id, bucket, storage_key, created_at, attempts` | Outbox for object deletions |

### 9.3 API surface
All JSON; errors are RFC 9457 `application/problem+json` with a `requestId`.

| Area | Endpoints |
|---|---|
| Auth | `/api/auth/*` (Better Auth) |
| Me | `GET/PATCH/DELETE /api/me`, `GET /api/me/export` |
| Folders | `GET/POST /api/folders`, `PATCH/DELETE /api/folders/:id` |
| Designs | `GET/POST /api/designs`, `GET/PUT/PATCH/DELETE /api/designs/:id`, `POST /api/designs/:id/duplicate` |
| Share | `POST /api/designs/:id/share`, `DELETE /api/designs/:id/share/:linkId`, `GET /api/shared/:token`, `POST /api/shared/:token/remix` |
| Assets | `GET /api/assets`, `POST /api/assets/uploads`, `POST /api/assets/:id/complete`, `POST /api/assets/resolve`, `DELETE /api/assets/:id` |
| Templates | `GET /api/templates`, `GET /api/templates/:id`, `POST /api/templates/:id/use`, `POST /api/templates/preflight`, `POST /api/templates`, `POST /api/templates/:id/versions`, `POST /api/templates/:id/reports` |
| Users | `GET /api/users/:handle` |
| Admin | `GET /api/admin/reports`, `POST /api/admin/reports/:id/resolve`, `POST /api/admin/templates/:id/moderate` |
| Ops | `GET /api/health`, `GET /api/cron/cleanup` (bearer `CRON_SECRET`) |

Lists use keyset (cursor) pagination, max 50 per page.

### 9.4 Upload flow
1. `POST /api/assets/uploads { kind, mime, bytes }` → checks MIME allowlist (`image/jpeg`, `image/png`, `image/webp`; **no SVG from users**), size ≤ 15 MB, per-user quota (500 MB), rate limit → creates a `pending` asset → returns a presigned PUT URL (5-minute expiry, bound `Content-Type` and `Content-Length`).
2. Browser PUTs the bytes straight to R2.
3. `POST /api/assets/:id/complete { width, height }` → server HEADs the object (size matches), reads the first 16 bytes and **verifies the file signature** (JPEG `FF D8 FF`, PNG `89 50 4E 47…`, WebP `RIFF….WEBP`) matches the declared MIME → marks `ready`, else deletes the object and rejects.
4. Reads go through `POST /api/assets/resolve { ids }` → returns signed GET URLs (1 hour) for private assets the caller may see, CDN URLs for public ones. Pending assets older than 24 h are purged by cron.

### 9.5 Security controls
| Threat | Control |
|---|---|
| Account takeover | Better Auth; Google OAuth + single-use 10-minute magic links; DB sessions; `HttpOnly; Secure; SameSite=Lax` cookies; 30-day rolling expiry; auth-route rate limits |
| IDOR / broken access control | Every query owner-scoped in repositories; foreign resources return **404** (no existence leaks); admin checks on `/api/admin/*`; automated cross-user tests for every resource |
| CSRF | `SameSite=Lax` cookies + strict `Origin` check on every state-changing request (Better Auth performs its own on auth routes) |
| XSS | React escaping; user text is drawn on canvas, never injected as HTML; no `dangerouslySetInnerHTML` on user data; nonce-based CSP |
| Malicious uploads | MIME allowlist, file-signature sniffing, size limits, quota, no user SVG, server-generated keys, private bucket |
| Malicious documents | Hand-written validator with strict limits; SVG path data validated against the path grammar; assets referenced by ID only; ownership check of every referenced asset on save/publish |
| Data leakage via published templates | Privacy scrub (placeholder replacement by default, explicit ownership attestation to keep) + PII warnings |
| Share-link guessing | 128-bit random tokens, stored as SHA-256 hashes, revocable, read-only, rate-limited |
| Abuse / scraping / spam | Postgres-backed fixed-window rate limiter (see 9.6); report dedupe; publish cap |
| Clickjacking / sniffing / downgrade | CSP `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, HSTS (prod), `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` denying camera/mic/geo, `Cross-Origin-Opener-Policy: same-origin` |
| Secret leakage | Env validated at boot (fail fast); `server-only` imports; `.env.example` only; gitleaks in CI; no secrets or tokens in logs |
| Supply chain | Frozen lockfile; Dependabot; dependency-review on PRs; `pnpm audit --audit-level high`; CodeQL; least-privilege workflow permissions |
| Privacy (DPDP / GDPR-style) | Minimal PII (email, name, avatar); self-serve data export; account deletion cascades rows and queues storage deletions |
| Accountability | Append-only `audit_log` for admin actions and account deletions |

### 9.6 Rate limits
| Action | Limit | Key |
|---|---|---|
| Magic-link send | 5 / hour | email; 20 / hour per IP (Better Auth rules) |
| Upload URL | 60 / hour | user |
| Design save (PUT) | 120 / minute | user |
| Share link create | 30 / hour | user |
| Shared view | 120 / minute | IP |
| Publish | 5 / day | user |
| Report | 20 / day | user |
| Gallery / public reads | 300 / minute | IP |

Client IP comes from the platform header only when `TRUST_PROXY=true` (Vercel), otherwise from the socket address.

### 9.7 Operations
Structured JSON logs with `requestId` and no PII; `GET /api/health` checks the DB; Vercel Cron hits `/api/cron/cleanup` hourly (purge stale pending uploads, expired rate-limit windows, process the storage-deletion outbox with retry). Config is validated with Zod at startup; `.env.example` documents every variable.

### 9.8 CI/CD
| Workflow | Trigger | Jobs |
|---|---|---|
| `ci.yml` | PR + push to `main` | install (frozen) → lint → typecheck → unit & integration tests (PGlite) → migrations applied to a real Postgres 17 service container → `next build` |
| `security.yml` | PR, push, weekly | CodeQL (JS/TS), dependency-review (PR), `pnpm audit`, gitleaks |
| `deploy.yml` | push to `main` (after CI) + manual | `production` environment (protected) → Drizzle migrations against prod DB → Vercel prebuilt deploy |
| Dependabot | weekly | npm + GitHub Actions updates |

Branch protection on `main`: required CI + security checks, linear history, no force pushes.

---

## 10. Frontend (P1–P3)

- **Rendering model:** Server Components for public/SEO pages (Gallery, Template Detail, Profile, Shared View, Landing); Client Components for Editor, Author Mode, Media Library, Dashboard interactions. The editor bundle is lazy-loaded and never shipped on public pages.
- **Data access:** Server Components call services directly; client code uses a small typed fetch client (no data-fetching library).
- **Styling:** Tailwind CSS v4 with design tokens as CSS custom properties; light + dark themes.
- **UI components (from scratch, `packages/ui`):** Button, IconButton, Input, Textarea, Select, Combobox, Slider, ColorPicker (HSV + hex + swatches + eyedropper where supported), Popover, Tooltip, Menu/ContextMenu, Dialog, Sheet, Tabs, Toast, Stepper, Badge, Avatar, Skeleton, EmptyState, SegmentedControl, Toggle, VirtualMasonry (gallery), VirtualList, SortableTree (layers panel), DropZone, KeyboardShortcut registry.
- **Accessibility:** WCAG 2.2 AA contrast; full keyboard operation of all panels; correct ARIA roles on custom widgets; focus trapping in dialogs; the layers panel is the accessible mirror of the canvas; `prefers-reduced-motion` respected.
- **Responsive:** public pages and dashboard from 360 px; Editor and Author Mode require ≥ 1024 px (smaller screens see a view/export-only state).
- Page-by-page specifications: [`docs/frontend-design-brief.md`](../../frontend-design-brief.md).

---

## 11. Quality

### 11.1 Performance budgets
| Metric | Budget |
|---|---|
| Editor frame time while dragging (150 layers, 10 filtered photos) | ≤ 16 ms |
| Filter slider preview | ≤ 1 frame at on-screen resolution |
| Export 1080×1920 @ 2× | ≤ 1.5 s |
| Gallery LCP (4G, mid device) | ≤ 2.5 s |
| Public page JS | ≤ 150 KB gzipped |
| API p95 (warm) | ≤ 200 ms |

### 11.2 Error handling
- API: problem+json, no stack traces in production, `requestId` for correlation.
- Autosave: 409 on version conflict → "This design changed in another tab" dialog (reload theirs / keep mine as a copy).
- Uploads: per-file progress and retry; rejected files explain why (type, size, quota).
- Engine: WebGL context-loss recovery; missing asset renders a "missing photo" frame state; failed font load falls back to a system font with a toast.
- Export: font/filter readiness awaited; size-cap error with suggested scale.

### 11.3 Testing strategy
| Layer | Tooling | Covers |
|---|---|---|
| Unit | Vitest | schema validator & migrations, path validator, file-signature sniffing, rate limiter, engine math/snapping/text layout (P1) |
| Integration | Vitest + PGlite | services + repositories end-to-end: CRUD, owner scoping, optimistic concurrency, publish rules, moderation, share tokens, account deletion |
| Route | Vitest | handlers: status codes, problem+json, origin checks, auth required |
| Security | Vitest | IDOR matrix, CSRF origin rejection, upload spoofing, rate-limit exhaustion, header presence |
| E2E | Playwright (P1+) | the five key journeys |
| Visual regression | Playwright (P1+) | each seed template rendered and pixel-compared |

---

## 12. Milestones
| Milestone | Contents | Exit criteria |
|---|---|---|
| **M0** | Repo, schema package, backend, security controls, CI/CD | All tests green; CI + security workflows pass; deploy workflow documented |
| **M1** | Engine core (math, scene, commands, render, hit-test, snapping, text) | 60 fps budget met in benchmark page |
| **M2** | Filters + export + Editor UI + P1 pages + seed templates | Journey 1 passes E2E |
| **M3** | Auth UI, onboarding, settings, media library, Author Mode | Journeys 2–3 (authoring part) pass |
| **M4** | Publish flow, profiles, share/remix, moderation, landing | Journeys 3–5 pass |
| **M5** | Performance pass, accessibility audit, README with benchmarks, demo video | Budgets in 11.1 met and documented |

---

## 13. Risks
| Risk | Mitigation |
|---|---|
| Editor scope swallows the timeline | Phase gates; P1 is demo-able alone |
| Text layout edge cases (fonts, IME, wrapping) | Single style per layer; DOM overlay for input; visual regression tests |
| GPU variability across laptops | Preview-resolution filtering, context-loss recovery, WebGL2-absent fallback |
| Free-tier limits (Neon, R2, Vercel) | Quotas, rate limits, cleanup cron |
| Better Auth / Next.js major-version churn | Pinned versions, Dependabot, CI on every update |

---

## 14. Deviations from earlier conversation (flag for review)
| Earlier | Now | Why |
|---|---|---|
| Next.js 15 | **Next.js 16** | Current stable (16.3) at build time |
| Auth.js | **Better Auth** | Auth.js is now maintained under the Better Auth project, which is the recommended choice for new apps; first-class Drizzle adapter, built-in rate limiting and magic links |
| Prisma | **Drizzle ORM** | Runs against **PGlite**, giving real-Postgres integration tests without Docker (Docker isn't running on the dev machine); SQL-first queries are easier to reason about for owner scoping |
| Asset `src` in document | **Asset IDs only** | Removes URLs from the format entirely (security) |

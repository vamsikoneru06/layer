# VASH threat model

What VASH protects, who might attack it, and which control stops each attack. Update this file when data
handling, auth or storage changes. Last reviewed 2026-10-03 against `main` at 5392cf4 plus PRs #23 to #25.

## What we protect

| Asset | Why it matters |
|---|---|
| Users' photos | Personal, often of family and children. A leak is the worst outcome VASH can have. |
| Users' designs | Private by default; may contain names, dates, addresses. |
| Accounts and sessions | A stolen session gives access to all of the above. |
| Email addresses | Only used to sign in; never shown publicly. |
| Public templates | Must not carry another person's photos or personal details (publish scrub, moderation). |
| Free-tier quotas | 1 GB storage, 0.5 GB database, ~500 emails/day. Abuse can take the whole service down. |
| Secrets in `.env.local` | Database, storage, auth and mail keys. |

## Trust boundaries

```
Browser ──HTTPS──> Vercel (Next.js proxy + route handlers) ──TLS──> Neon Postgres
   │                         │
   │                         └──S3 API──> Supabase Storage (private + public buckets)
   └──presigned PUT/GET (short-lived, one object)──> Supabase Storage
```

Everything the browser sends is untrusted, including documents: they are validated by `@vash/schema`
before they are stored or rendered.

## Threats and controls (STRIDE)

| Threat | Example | Control | Where |
|---|---|---|---|
| Spoofing | Sign in as someone else | Magic links expire in 10 min and are rate limited per email and IP; Google OAuth via Better Auth; `trustedOrigins` is the app origin only | `server/auth/auth.ts`, `rate-limit/rules.ts` |
| Spoofing | Cross-site request with the victim's cookie | Every non-GET request must carry `Origin: APP_ORIGIN`; cookies are SameSite | `server/http/endpoint.ts` |
| Tampering | Edit or read another user's design or photo | Every query is owner-scoped; cross-user tests for every resource | `server/**/repository.ts`, `*.test.ts` |
| Tampering | Two tabs overwrite each other | Compare-and-swap on `designs.version`; the editor shows a conflict dialog | `server/designs/repository.ts` |
| Tampering | Upload a script or HTML file named `.jpg` | Uploads land on a staging key; `complete` checks size and file signature (magic bytes) on a server-side copy; the type is signed into the upload URL | `server/assets/service.ts`, `sniff.ts` |
| Tampering | Path data that smuggles markup | Path strings accept only the SVG path grammar | `packages/schema/src/path.ts` |
| Repudiation | An admin hides a template and denies it | Each moderation action writes an audit row in the same transaction (PR #25) | `server/admin/service.ts` |
| Information disclosure | Hot-linking, tracking pixels, SSRF through documents | Documents hold asset ids only, never URLs; ids resolve to short-lived signed URLs | spec §5, `server/assets` |
| Information disclosure | Share token or email in logs | Share tokens are stripped from logged paths; with PR #25 they are stored only as a SHA-256 hash, and profiles show name and handle only | `server/http/endpoint.ts`, `server/shares` |
| Information disclosure | A hidden template's photos stay reachable | Resolve refuses for hidden templates (PR #23); moving public copies out of the public bucket is still open (decision row 40) | `server/assets/service.ts` |
| Information disclosure | XSS reads the session | Strict CSP with a per-request nonce, no third-party script/font/image hosts; React escaping | `proxy.ts`, `security/headers.ts` |
| Information disclosure | Clickjacking | `frame-ancestors 'none'` | `security/headers.ts` |
| Denial of service | Flood sign-in, uploads, saves, publishes | Postgres-backed rate limits per user, IP or hashed email (shared by all instances) | `rate-limit/` |
| Denial of service | Fill the free storage tier | 500 MB per user (50 MB with database storage, PR #24), 15 MB per file, quota includes staged and queued objects | `server/assets/service.ts` (`UPLOAD_LIMITS`) |
| Denial of service | A slow database or storage call ties up functions | Pool connect timeout 5 s, query timeout 15 s; S3 connect 5 s, request 20 s | `db/client.ts`, `storage/s3.ts` |
| Elevation of privilege | A user calls admin endpoints | `endpoint(..., { auth: "admin" })` checks the stored role on every request | `server/http/endpoint.ts` |
| Supply chain | A compromised dependency or leaked key | gitleaks, CodeQL, `pnpm audit`, dependency review in CI; Dependabot | `.github/workflows` |

## Known gaps, in priority order

1. **Hidden templates' public copies** stay in the public bucket until moderation moves them (decision row 40).
2. **Admin accounts have no second factor of their own.** Sign-in is passwordless, so an account is as strong
   as its email inbox or Google account. Before inviting other moderators: require admins to sign in with
   Google (which enforces its own 2-step verification) or add Better Auth's passkey plugin (free).
3. **Guest mode (planned) keeps photos in the browser.** IndexedDB data is readable by anyone using that
   browser profile. The UI must say so, and offer "Clear this device".
4. **Secret rotation has no written procedure.** Rotating `BETTER_AUTH_SECRET` signs everyone out; storage
   keys need rotating in Supabase and Vercel together. Write the runbook before launch.
5. **No restore drill.** Neon and Supabase keep backups on their side; a restore has never been tested.

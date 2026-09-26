# Storage & Uploads Implementation Plan (Phase 0, Plan 2 of 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Users can upload photos straight from the browser to object storage, and the server proves every file is the image it claims to be before anyone can use it. Documents and viewers get short-lived URLs for the assets they may see, and a scheduled job cleans up abandoned uploads, stale rate-limit windows, expired sign-in rows and queued object deletions.

**Architecture:**
- Object storage sits behind a small `ObjectStorage` port. Production uses an S3 adapter pointed at Supabase Storage's S3-compatible API (presigned URLs use SigV4). Tests use an in-memory adapter.
- The assets service follows spec §9.4: request a presigned PUT → the browser uploads directly → `complete` checks the object's size and its first 16 bytes, then marks it ready.
- Deletions go through the existing `storage_deletions` outbox. `GET /api/cron/cleanup`, protected by a bearer secret, drains it.

**Tech Stack:** Next.js 16 route handlers · Drizzle over Postgres/PGlite · `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` (already dependencies) · Supabase Storage (free tier, S3 protocol) · Zod request DTOs · Vitest.

**Spec:** `docs/superpowers/specs/2026-09-24-vash-design.md`: §9.4 (upload flow), §9.5 (malicious uploads), §9.6 (upload limit), §9.7 (cron), §9.2 (`assets`, `storage_deletions`). Also read `docs/free-stack.md` (why Supabase Storage replaces R2) and `docs/decisions.md`.

**Plan series:** Plan 1 (backend foundation) is done. **Plan 2 (this one):** storage and uploads. Plan 3: templates and gallery, share links and remix, `GET /api/users/:handle`, moderation. Plan 4: deploy (Vercel, Neon, Supabase provisioning, `deploy.yml`).

## Global Constraints

- Commands run through corepack because bare `pnpm` isn't on PATH: `corepack pnpm --filter @vash/web …`.
- MIME allowlist: "`image/jpeg`, `image/png`, `image/webp`; **no SVG from users**", "size ≤ 15 MB", "per-user quota (500 MB)".
- Presigned PUT: "5-minute expiry, bound `Content-Type` and `Content-Length`".
- Complete: "server HEADs the object (size matches), reads the first 16 bytes and **verifies the file signature** (JPEG `FF D8 FF`, PNG `89 50 4E 47…`, WebP `RIFF….WEBP`) matches the declared MIME → marks `ready`, else deletes the object and rejects."
- Resolve: "returns signed GET URLs (1 hour) for private assets the caller may see, CDN URLs for public ones. Pending assets older than 24 h are purged by cron."
- "Storage keys are server-generated (`u/{userId}/{assetId}`); user filenames never used."
- Upload URL rate limit: 60 per hour per user (`RATE_LIMITS.uploadUrl`, already defined).
- Cron: "`GET /api/cron/cleanup` (bearer `CRON_SECRET`)". It runs **daily**, not hourly, because Vercel Hobby only allows daily cron jobs (decision row 28).
- Foreign or unknown resources answer 404. Resolve silently omits ids the caller may not see. Every error is problem+json with a `requestId`.
- Never log keys, signed URLs or secrets. The existing logger redacts `*secret*`, `*token*` and `*key*` fields, and callers must not put URLs in log fields.

## Review Focus

1. **A browser PUT whose bytes don't match the declaration**: a different length, or HTML/SVG renamed to `.png`. `complete` must reject it with 422 and remove both the row and the object. Covered in Task 4 (size-mismatch and spoofed-type tests).
2. **`complete` called twice, or before the PUT finished.** The first gets 409 ("upload it first"), and a repeat after success returns the same ready asset. Covered in Task 4.
3. **Resolve with duplicate, foreign, pending or garbage ids.** Only visible ready assets come back, each once, with nothing revealing whether the others exist. Covered in Task 5.
4. **Storage failing while deleting.** The row is still removed, and the object key is queued in the outbox rather than lost. Covered in Task 4 (spoof with a failing remove) and Task 5 (DELETE with a failing remove).
5. **The cron firing twice, or overlapping itself.** The second run finds nothing left to do, and outbox deletions are idempotent. Covered in Task 7.

---

## File Structure

```
apps/web/
├─ vercel.json                               daily cron schedule
├─ .env.example                              (modify) STORAGE_* and CRON_SECRET
├─ src/server/
│  ├─ config.ts                              (modify) StorageConfig, cronSecret
│  ├─ context.ts                             (modify) wire storage, assets, cron
│  ├─ security/headers.ts                    (modify) storage origins in img-src/connect-src
│  ├─ storage/types.ts                       ObjectStorage port + Bucket
│  ├─ storage/s3.ts                          S3 adapter (Supabase Storage)
│  ├─ storage/outbox.ts                      drains storage_deletions
│  ├─ assets/sniff.ts                        file-signature sniffing
│  ├─ assets/repository.ts                   (modify) queries for the assets table
│  ├─ assets/service.ts                      upload rules: quota, complete, discard, resolve
│  ├─ assets/handlers.ts                     /api/assets/* handlers
│  └─ cron/{cleanup,handlers}.ts             scheduled cleanup
├─ src/proxy.ts                              (modify) pass storage origins to the CSP
├─ src/app/api/assets/**/route.ts            one-line forwards
├─ src/app/api/cron/cleanup/route.ts
└─ tests/support/{config,storage}.ts         (modify config) + in-memory ObjectStorage
docs/decisions.md, docs/free-stack.md        (modify)
```

Assets handlers take `storage` as a second argument rather than a new field on `Deps`, so the existing handler tests and `testDeps` stay untouched. When storage isn't configured (local development without Supabase), asset endpoints answer 503 and the rest of the app still works.

---

### Task 1: Storage and cron configuration

**Files:**
- Modify: `apps/web/src/server/config.ts`, `apps/web/src/server/config.test.ts`, `apps/web/tests/support/config.ts`, `apps/web/.env.example`

**Interfaces:**
- Produces:
  ```ts
  interface StorageConfig { endpoint: string; region: string; accessKeyId: string; secretAccessKey: string;
                            privateBucket: string; publicBucket: string; publicBaseUrl: string }
  AppConfig.storage: StorageConfig | null      // all five STORAGE_* connection vars set, or none
  AppConfig.cronSecret: string | null
  ```
  In production, both `storage` and `CRON_SECRET` are required.

- [ ] **Step 1: Write the failing tests.** Append to `apps/web/src/server/config.test.ts`, inside `describe("loadConfig")`:

```ts
  const storageEnv = {
    STORAGE_ENDPOINT: "https://proj.storage.supabase.co/storage/v1/s3",
    STORAGE_REGION: "ap-south-1",
    STORAGE_ACCESS_KEY_ID: "key-id",
    STORAGE_SECRET_ACCESS_KEY: "secret-access-key",
    STORAGE_PUBLIC_BASE_URL: "https://proj.supabase.co/storage/v1/object/public/vash-public/",
  };

  it("configures storage only when every STORAGE_* connection variable is set", () => {
    expect(loadConfig(base).storage).toBeNull();
    expect(loadConfig({ ...base, ...storageEnv }).storage).toEqual({
      endpoint: "https://proj.storage.supabase.co/storage/v1/s3",
      region: "ap-south-1",
      accessKeyId: "key-id",
      secretAccessKey: "secret-access-key",
      privateBucket: "vash-private",
      publicBucket: "vash-public",
      publicBaseUrl: "https://proj.supabase.co/storage/v1/object/public/vash-public",
    });
    const message = errorOf({ ...base, STORAGE_ENDPOINT: storageEnv.STORAGE_ENDPOINT });
    expect(message).toContain("STORAGE_SECRET_ACCESS_KEY");
    expect(message).not.toContain("proj.storage");
  });

  it("rejects invalid bucket names and short cron secrets", () => {
    expect(errorOf({ ...base, ...storageEnv, STORAGE_PUBLIC_BUCKET: "Bad_Bucket" })).toContain("STORAGE_PUBLIC_BUCKET");
    expect(errorOf({ ...base, CRON_SECRET: "short" })).toContain("CRON_SECRET");
    expect(loadConfig({ ...base, CRON_SECRET: "c".repeat(32) }).cronSecret).toBe("c".repeat(32));
  });

  it("requires storage and a cron secret in production", () => {
    const message = errorOf({ ...base, NODE_ENV: "production" });
    expect(message).toContain("STORAGE_ENDPOINT");
    expect(message).toContain("CRON_SECRET");
  });
```

- [ ] **Step 2: Run to verify it fails.**
Run: `corepack pnpm --filter @vash/web exec vitest run src/server/config.test.ts`
Expected: the 3 new tests FAIL (`storage` is undefined; no STORAGE/CRON issues).

- [ ] **Step 3: Implement.** In `apps/web/src/server/config.ts`:

Add the new config fields to `AppConfig` and export a `StorageConfig` type:
```ts
export interface StorageConfig {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  privateBucket: string;
  publicBucket: string;
  publicBaseUrl: string;
}
```
Also add these two fields to the `AppConfig` interface:
```ts
  storage: StorageConfig | null;
  cronSecret: string | null;
```

Next to the existing `optional` helper:
```ts
const optionalUrl = z.preprocess((v) => (v === "" ? undefined : v), z.url().optional());
const bucket = z.string().regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/, "must be a lowercase bucket name");
const STORAGE_CONNECTION_VARS = ["STORAGE_ENDPOINT", "STORAGE_REGION", "STORAGE_ACCESS_KEY_ID", "STORAGE_SECRET_ACCESS_KEY", "STORAGE_PUBLIC_BASE_URL"] as const;
```

Add these keys to the `EnvSchema` object:
```ts
    // Supabase Storage (S3 protocol): Project settings → Storage → S3 Connection / S3 Access Keys.
    STORAGE_ENDPOINT: optionalUrl,
    STORAGE_REGION: optional,
    STORAGE_ACCESS_KEY_ID: optional,
    STORAGE_SECRET_ACCESS_KEY: optional,
    STORAGE_PUBLIC_BASE_URL: optionalUrl,
    STORAGE_PRIVATE_BUCKET: bucket.default("vash-private"),
    STORAGE_PUBLIC_BUCKET: bucket.default("vash-public"),
    CRON_SECRET: z.preprocess((v) => (v === "" ? undefined : v), z.string().min(32, "must be at least 32 characters").optional()),
```

Add to `superRefine`, before the production block:
```ts
    const storageSet = STORAGE_CONNECTION_VARS.filter((k) => env[k]);
    if (storageSet.length > 0 && storageSet.length < STORAGE_CONNECTION_VARS.length) {
      for (const k of STORAGE_CONNECTION_VARS) {
        if (!env[k]) ctx.addIssue({ code: "custom", path: [k], message: "set all STORAGE_* connection variables together, or none" });
      }
    }
```
Add inside the production block:
```ts
      if (storageSet.length === 0) ctx.addIssue({ code: "custom", path: ["STORAGE_ENDPOINT"], message: "required in production (photo uploads)" });
      if (!env.CRON_SECRET) ctx.addIssue({ code: "custom", path: ["CRON_SECRET"], message: "required in production (scheduled cleanup)" });
```

Add to the object `loadConfig` returns:
```ts
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
```
`superRefine` has already guaranteed all-or-none, so this conditional only narrows types.

In `apps/web/tests/support/config.ts`, add `storage: null,` and `cronSecret: null,` to `testConfig`.

Append to `apps/web/.env.example`:
```bash
# Photo storage: Supabase Storage via its S3 API (free, no card). Set all five, or none (uploads then answer 503).
# Supabase → Project settings → Storage → S3 Connection (endpoint, region) and S3 Access Keys.
STORAGE_ENDPOINT=
STORAGE_REGION=
STORAGE_ACCESS_KEY_ID=
STORAGE_SECRET_ACCESS_KEY=
# Public bucket URL: https://<project-ref>.supabase.co/storage/v1/object/public/vash-public
STORAGE_PUBLIC_BASE_URL=
STORAGE_PRIVATE_BUCKET=vash-private
STORAGE_PUBLIC_BUCKET=vash-public
# 32+ random characters; Vercel Cron sends it as "Authorization: Bearer <CRON_SECRET>". Required in production.
CRON_SECRET=
```

- [ ] **Step 4: Run tests, typecheck.**
Run: `corepack pnpm --filter @vash/web exec vitest run src/server/config.test.ts && corepack pnpm --filter @vash/web typecheck`
Expected: PASS. Every existing config test still passes.

- [ ] **Step 5: Commit.**
```bash
git add apps/web/src/server/config.ts apps/web/src/server/config.test.ts apps/web/tests/support/config.ts apps/web/.env.example
git commit -m "feat(web): storage and cron secret configuration"
```

---

### Task 2: File-signature sniffing

**Files:**
- Create: `apps/web/src/server/assets/sniff.ts`
- Test: `apps/web/src/server/assets/sniff.test.ts`

**Interfaces:**
- Produces: `type SniffedMime = "image/jpeg" | "image/png" | "image/webp"`, `SNIFF_BYTES = 16`, `sniffImageMime(bytes: Uint8Array): SniffedMime | null`

- [ ] **Step 1: Write the failing test.**

`apps/web/src/server/assets/sniff.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { sniffImageMime } from "./sniff";

const bytes = (...values: number[]) => new Uint8Array(values);
const ascii = (s: string) => new TextEncoder().encode(s);

describe("sniffImageMime", () => {
  it("recognises JPEG, PNG and WebP by their magic bytes", () => {
    expect(sniffImageMime(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10))).toBe("image/jpeg");
    expect(sniffImageMime(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d))).toBe("image/png");
    expect(sniffImageMime(new Uint8Array([...ascii("RIFF"), 0x24, 0, 0, 0, ...ascii("WEBPVP8 ")]))).toBe("image/webp");
  });

  it.each([
    ["SVG", ascii('<svg xmlns="http://www.w3.org/2000/svg">')],
    ["HTML", ascii("<!doctype html><script>")],
    ["GIF", ascii("GIF89a\u0001\u0000")],
    ["WAV (RIFF but not WEBP)", new Uint8Array([...ascii("RIFF"), 0x24, 0, 0, 0, ...ascii("WAVEfmt ")])],
    ["a truncated PNG header", bytes(0x89, 0x50, 0x4e, 0x47)],
    ["nothing", new Uint8Array()],
  ])("rejects %s", (_name, input) => {
    expect(sniffImageMime(input)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails.**
Run: `corepack pnpm --filter @vash/web exec vitest run src/server/assets/sniff.test.ts`
Expected: FAIL with "Cannot find module './sniff'".

- [ ] **Step 3: Implement.**

`apps/web/src/server/assets/sniff.ts`:
```ts
export type SniffedMime = "image/jpeg" | "image/png" | "image/webp";

/** How many leading bytes `sniffImageMime` needs (WebP's marker ends at byte 12). */
export const SNIFF_BYTES = 16;

const JPEG = [0xff, 0xd8, 0xff];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const RIFF = [0x52, 0x49, 0x46, 0x46];
const WEBP = [0x57, 0x45, 0x42, 0x50];

const has = (bytes: Uint8Array, signature: number[], at = 0) => signature.every((value, i) => bytes[at + i] === value);

/** The image type a file's leading bytes prove, or null. Never trust the declared MIME or the extension. */
export function sniffImageMime(bytes: Uint8Array): SniffedMime | null {
  if (has(bytes, JPEG)) return "image/jpeg";
  if (has(bytes, PNG)) return "image/png";
  if (has(bytes, RIFF) && has(bytes, WEBP, 8)) return "image/webp";
  return null;
}
```

- [ ] **Step 4: Run to verify it passes.**
Run: `corepack pnpm --filter @vash/web exec vitest run src/server/assets/sniff.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit.**
```bash
git add apps/web/src/server/assets/sniff.ts apps/web/src/server/assets/sniff.test.ts
git commit -m "feat(web): verify uploaded images by their file signature"
```

---

### Task 3: Object storage port, S3 adapter, in-memory test double

**Files:**
- Create: `apps/web/src/server/storage/types.ts`, `apps/web/src/server/storage/s3.ts`, `apps/web/tests/support/storage.ts`
- Test: `apps/web/src/server/storage/s3.test.ts`

**Interfaces:**
- Consumes: `StorageConfig` (Task 1)
- Produces:
  ```ts
  type Bucket = "private" | "public"
  interface ObjectStorage {
    presignUpload(bucket: Bucket, key: string, o: { contentType: string; contentLength: number; expiresInSeconds: number }): Promise<string>;
    presignDownload(bucket: Bucket, key: string, expiresInSeconds: number): Promise<string>;
    publicUrl(key: string): string;
    head(bucket: Bucket, key: string): Promise<{ contentLength: number } | null>;
    readPrefix(bucket: Bucket, key: string, length: number): Promise<Uint8Array>;
    remove(bucket: Bucket, key: string): Promise<void>;   // idempotent
  }
  s3Storage(config: StorageConfig, client?: S3Client): ObjectStorage
  // tests/support/storage.ts
  memoryStorage(): ObjectStorage & { objects: Map<string, Uint8Array>; failRemove: Set<string>; put(bucket: Bucket, key: string, bytes: Uint8Array): void; has(bucket: Bucket, key: string): boolean }
  ```

- [ ] **Step 1: Write the failing test.** Presigning is local computation, so these tests need no network.

`apps/web/src/server/storage/s3.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { s3Storage } from "./s3";

const config = {
  endpoint: "https://proj.storage.supabase.co/storage/v1/s3",
  region: "ap-south-1",
  accessKeyId: "test-access-key",
  secretAccessKey: "test-secret-key",
  privateBucket: "vash-private",
  publicBucket: "vash-public",
  publicBaseUrl: "https://proj.supabase.co/storage/v1/object/public/vash-public",
};

describe("s3Storage", () => {
  it("presigns a PUT bound to the declared type and length, valid for the given seconds", async () => {
    const url = new URL(await s3Storage(config).presignUpload("private", "u/user-1/asset-1", { contentType: "image/png", contentLength: 1234, expiresInSeconds: 300 }));
    expect(url.origin).toBe("https://proj.storage.supabase.co");
    expect(url.pathname).toBe("/storage/v1/s3/vash-private/u/user-1/asset-1");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(url.searchParams.get("X-Amz-SignedHeaders")?.split(";")).toEqual(expect.arrayContaining(["content-length", "content-type", "host"]));
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("presigns downloads from the requested bucket", async () => {
    const url = new URL(await s3Storage(config).presignDownload("private", "u/user-1/asset-1", 3600));
    expect(url.pathname).toBe("/storage/v1/s3/vash-private/u/user-1/asset-1");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("3600");
  });

  it("builds public URLs under the public base, encoding each key segment", () => {
    expect(s3Storage(config).publicUrl("t/tpl 1/a#b")).toBe("https://proj.supabase.co/storage/v1/object/public/vash-public/t/tpl%201/a%23b");
  });
});
```

- [ ] **Step 2: Run to verify it fails.**
Run: `corepack pnpm --filter @vash/web exec vitest run src/server/storage/s3.test.ts`
Expected: FAIL with "Cannot find module './s3'".

- [ ] **Step 3: Implement.**

`apps/web/src/server/storage/types.ts`:
```ts
export type Bucket = "private" | "public";

/** Object storage as the app needs it. Keys are always server-generated (see assets/repository.assetKey). */
export interface ObjectStorage {
  presignUpload(bucket: Bucket, key: string, o: { contentType: string; contentLength: number; expiresInSeconds: number }): Promise<string>;
  presignDownload(bucket: Bucket, key: string, expiresInSeconds: number): Promise<string>;
  publicUrl(key: string): string;
  head(bucket: Bucket, key: string): Promise<{ contentLength: number } | null>;
  readPrefix(bucket: Bucket, key: string, length: number): Promise<Uint8Array>;
  /** Idempotent: removing a missing object succeeds. */
  remove(bucket: Bucket, key: string): Promise<void>;
}
```

`apps/web/src/server/storage/s3.ts`:
```ts
import "server-only";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, NotFound, PutObjectCommand, S3Client, S3ServiceException } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { StorageConfig } from "../config";
import type { Bucket, ObjectStorage } from "./types";

const isNotFound = (err: unknown) =>
  err instanceof NotFound || (err instanceof S3ServiceException && err.$metadata.httpStatusCode === 404);

/** Supabase Storage (or any S3-compatible store) over the S3 protocol, path-style. */
export function s3Storage(
  config: StorageConfig,
  client: S3Client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: true,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  }),
): ObjectStorage {
  const bucketName = (bucket: Bucket) => (bucket === "public" ? config.publicBucket : config.privateBucket);
  return {
    presignUpload: (bucket, key, o) =>
      getSignedUrl(client, new PutObjectCommand({ Bucket: bucketName(bucket), Key: key, ContentType: o.contentType, ContentLength: o.contentLength }), {
        expiresIn: o.expiresInSeconds,
        // Signed, so the browser can't PUT a different type or size with this URL.
        signableHeaders: new Set(["content-type", "content-length"]),
      }),
    presignDownload: (bucket, key, expiresInSeconds) =>
      getSignedUrl(client, new GetObjectCommand({ Bucket: bucketName(bucket), Key: key }), { expiresIn: expiresInSeconds }),
    publicUrl: (key) => `${config.publicBaseUrl}/${key.split("/").map(encodeURIComponent).join("/")}`,
    async head(bucket, key) {
      try {
        const res = await client.send(new HeadObjectCommand({ Bucket: bucketName(bucket), Key: key }));
        return { contentLength: res.ContentLength ?? 0 };
      } catch (err) {
        if (isNotFound(err)) return null;
        throw err;
      }
    },
    async readPrefix(bucket, key, length) {
      const res = await client.send(new GetObjectCommand({ Bucket: bucketName(bucket), Key: key, Range: `bytes=0-${length - 1}` }));
      return (await res.Body?.transformToByteArray()) ?? new Uint8Array();
    },
    async remove(bucket, key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucketName(bucket), Key: key }));
    },
  };
}
```

`apps/web/tests/support/storage.ts`:
```ts
import type { Bucket, ObjectStorage } from "@/server/storage/types";

/** In-memory ObjectStorage. `put` plays the browser's presigned PUT; keys in `failRemove` make `remove` throw. */
export function memoryStorage() {
  const objects = new Map<string, Uint8Array>();
  const failRemove = new Set<string>();
  const id = (bucket: Bucket, key: string) => `${bucket}:${key}`;
  const storage: ObjectStorage = {
    async presignUpload(bucket, key, o) {
      return `https://storage.test/${bucket}/${key}?op=put&type=${encodeURIComponent(o.contentType)}&length=${o.contentLength}&expires=${o.expiresInSeconds}`;
    },
    async presignDownload(bucket, key, expiresInSeconds) {
      return `https://storage.test/${bucket}/${key}?op=get&expires=${expiresInSeconds}`;
    },
    publicUrl: (key) => `https://cdn.test/${key}`,
    async head(bucket, key) {
      const bytes = objects.get(id(bucket, key));
      return bytes ? { contentLength: bytes.byteLength } : null;
    },
    async readPrefix(bucket, key, length) {
      return objects.get(id(bucket, key))?.slice(0, length) ?? new Uint8Array();
    },
    async remove(bucket, key) {
      if (failRemove.has(key)) throw new Error("storage unavailable");
      objects.delete(id(bucket, key));
    },
  };
  return {
    ...storage,
    objects,
    failRemove,
    put: (bucket: Bucket, key: string, bytes: Uint8Array) => void objects.set(id(bucket, key), bytes),
    has: (bucket: Bucket, key: string) => objects.has(id(bucket, key)),
  };
}
```

- [ ] **Step 4: Run tests, typecheck, lint.**
Run: `corepack pnpm --filter @vash/web exec vitest run src/server/storage && corepack pnpm --filter @vash/web typecheck && corepack pnpm --filter @vash/web lint`
Expected: PASS (3 tests).
- If `NotFound` isn't exported by the installed `@aws-sdk/client-s3`, keep only the `S3ServiceException` 404 check.
- If `X-Amz-SignedHeaders` lacks `content-length` (some SDK versions hoist it), add `unhoistableHeaders: new Set(["content-length", "content-type"])` to the presign options and re-run.

- [ ] **Step 5: Commit.**
```bash
git add apps/web/src/server/storage apps/web/tests/support/storage.ts
git commit -m "feat(web): object storage port with an S3 adapter for Supabase Storage"
```

---

### Task 4: Upload request and completion

**Files:**
- Modify: `apps/web/src/server/assets/repository.ts`
- Create: `apps/web/src/server/assets/service.ts`, `apps/web/src/server/assets/handlers.ts`
- Create: `apps/web/src/app/api/assets/uploads/route.ts`, `apps/web/src/app/api/assets/[id]/complete/route.ts`
- Modify: `apps/web/src/server/context.ts`
- Test: `apps/web/src/server/assets/uploads.test.ts`

**Interfaces:**
- Consumes: `ObjectStorage`, `memoryStorage`, `sniffImageMime`, `SNIFF_BYTES`, `RATE_LIMITS.uploadUrl`, kernel helpers (`endpoint`, `readJson`, `parseId`, `HttpError`, `notFound`, `conflict`, `unprocessable`), and the `user`, `assets` and `storageDeletions` tables
- Produces:
  ```ts
  // repository.ts (additions)
  type AssetRow = typeof assets.$inferSelect
  assetKey(ownerId: string, assetId: string): string                        // "u/{ownerId}/{assetId}"
  insertPendingAsset(db, v: { id; ownerId; kind: "photo" | "thumbnail"; mime; bytes; now: Date }): Promise<AssetRow>
  getOwnedAsset(db, ownerId, id): Promise<AssetRow | undefined>
  markAssetReady(db, ownerId, id, dims: { width: number; height: number }, now: Date): Promise<AssetRow | undefined>
  storageUsedBytes(db, ownerId): Promise<number>                            // pending + ready
  // service.ts
  UPLOAD_LIMITS = { maxBytes, storageQuotaBytes, uploadUrlSeconds: 300, downloadUrlSeconds: 3600, maxDimension: 16384 }
  UPLOAD_MIMES = ["image/jpeg", "image/png", "image/webp"]
  interface AssetContext { db: Db; now: () => Date; storage: ObjectStorage }
  requestUpload(ctx, ownerId, { kind, mime, bytes }): Promise<{ asset: AssetRow; upload: { url: string; method: "PUT"; headers: Record<string, string>; expiresAt: string } }>
  completeUpload(ctx, ownerId, id, { width, height }): Promise<AssetRow>
  discardAsset(ctx, asset: AssetRow): Promise<void>                          // row gone; object removed now or queued
  toAssetJson(a: AssetRow)
  // handlers.ts
  assetHandlers(deps: Deps, storage: ObjectStorage | null): { requestUpload: Handler; complete: Handler; … Task 5 adds list/resolve/remove }
  ```

- [ ] **Step 1: Write the failing tests.**

`apps/web/src/server/assets/uploads.test.ts`:
```ts
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../../tests/support/db";
import { testDeps } from "../../../tests/support/deps";
import { createAsset, createUser } from "../../../tests/support/factories";
import { call } from "../../../tests/support/invoke";
import { memoryStorage } from "../../../tests/support/storage";
import { assets, storageDeletions } from "../db/schema";
import { assetHandlers } from "./handlers";
import { UPLOAD_LIMITS } from "./service";

let t: TestDb;
let storage: ReturnType<typeof memoryStorage>;
let h: ReturnType<typeof assetHandlers>;
beforeAll(async () => {
  t = await createTestDb();
  storage = memoryStorage();
  h = assetHandlers(testDeps(t.db), storage);
});
afterAll(() => t.close());

const MB = 1024 * 1024;
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
function file(length: number, signature: number[] = PNG_SIG): Uint8Array {
  const bytes = new Uint8Array(length);
  bytes.set(signature.slice(0, length));
  return bytes;
}

async function requestUpload(owner: { id: string }, body: Record<string, unknown> = { kind: "photo", mime: "image/png", bytes: 64 }) {
  return call(h.requestUpload, { method: "POST", as: owner, body });
}
const keyOf = (ownerId: string, assetId: string) => `u/${ownerId}/${assetId}`;
const complete = (owner: { id: string }, id: string) => call(h.complete, { method: "POST", as: owner, params: { id }, body: { width: 1200, height: 900 } });

describe("POST /api/assets/uploads", () => {
  it("creates a pending asset and a presigned PUT bound to the declared type and size", async () => {
    const alice = await createUser(t.db);
    const res = await requestUpload(alice);
    expect(res.status).toBe(201);
    expect(res.body.asset).toMatchObject({ kind: "photo", mime: "image/png", bytes: 64, status: "pending", visibility: "private" });
    const url = new URL(res.body.upload.url);
    expect(url.pathname).toBe(`/private/${keyOf(alice.id, res.body.asset.id)}`);
    expect(url.searchParams.get("type")).toBe("image/png");
    expect(url.searchParams.get("length")).toBe("64");
    expect(url.searchParams.get("expires")).toBe("300");
    expect(res.body.upload).toMatchObject({ method: "PUT", headers: { "content-type": "image/png" } });
  });

  it.each([
    { kind: "photo", mime: "image/svg+xml", bytes: 10 },
    { kind: "photo", mime: "image/gif", bytes: 10 },
    { kind: "sticker", mime: "image/png", bytes: 10 },
    { kind: "photo", mime: "image/png", bytes: 0 },
    { kind: "photo", mime: "image/png", bytes: 15 * MB + 1 },
    { kind: "photo", mime: "image/png", bytes: 10, storageKey: "u/someone-else/x" },
  ])("rejects %j with 400", async (body) => {
    const alice = await createUser(t.db);
    expect((await requestUpload(alice, body)).status).toBe(400);
  });

  it("enforces the 500 MB quota, counting pending uploads", async () => {
    const alice = await createUser(t.db);
    await createAsset(t.db, { ownerId: alice.id, bytes: UPLOAD_LIMITS.storageQuotaBytes - 100 });
    expect((await requestUpload(alice, { kind: "photo", mime: "image/png", bytes: 60 })).status).toBe(201);
    const over = await requestUpload(alice, { kind: "photo", mime: "image/png", bytes: 60 });
    expect(over.status).toBe(422);
    expect(over.body).toMatchObject({ limitBytes: UPLOAD_LIMITS.storageQuotaBytes, usedBytes: UPLOAD_LIMITS.storageQuotaBytes - 40 });
  });

  it("allows 60 upload URLs per hour", async () => {
    const bob = await createUser(t.db);
    const fixed = new Date("2026-09-26T10:00:00.000Z");
    const limited = assetHandlers(testDeps(t.db, { now: () => fixed }), storage);
    let last = 0;
    for (let i = 0; i < 61; i++) last = (await call(limited.requestUpload, { method: "POST", as: bob, body: { kind: "photo", mime: "image/png", bytes: 8 } })).status;
    expect(last).toBe(429);
  });

  it("answers 503 when storage isn't configured", async () => {
    const alice = await createUser(t.db);
    const res = await call(assetHandlers(testDeps(t.db), null).requestUpload, { method: "POST", as: alice, body: { kind: "photo", mime: "image/png", bytes: 8 } });
    expect(res.status).toBe(503);
  });
});

describe("POST /api/assets/:id/complete", () => {
  it("marks a genuine upload ready and is idempotent", async () => {
    const alice = await createUser(t.db);
    const { body } = await requestUpload(alice);
    storage.put("private", keyOf(alice.id, body.asset.id), file(64));
    const first = await complete(alice, body.asset.id);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ id: body.asset.id, status: "ready", width: 1200, height: 900 });
    expect((await complete(alice, body.asset.id)).body.status).toBe("ready");
  });

  it("answers 409 before the file has been uploaded, leaving the asset pending", async () => {
    const alice = await createUser(t.db);
    const { body } = await requestUpload(alice);
    expect((await complete(alice, body.asset.id)).status).toBe(409);
    const [row] = await t.db.select().from(assets).where(eq(assets.id, body.asset.id));
    expect(row?.status).toBe("pending");
  });

  it("rejects a size mismatch and removes both the row and the object", async () => {
    const alice = await createUser(t.db);
    const { body } = await requestUpload(alice);
    const key = keyOf(alice.id, body.asset.id);
    storage.put("private", key, file(65));
    expect((await complete(alice, body.asset.id)).status).toBe(422);
    expect(await t.db.select().from(assets).where(eq(assets.id, body.asset.id))).toEqual([]);
    expect(storage.has("private", key)).toBe(false);
  });

  it.each([
    ["SVG disguised as PNG", "image/png", Array.from(new TextEncoder().encode("<svg onload=alert(1)>"))],
    ["HTML disguised as JPEG", "image/jpeg", Array.from(new TextEncoder().encode("<!doctype html>"))],
    ["a real PNG declared as JPEG", "image/jpeg", PNG_SIG],
  ])("rejects %s", async (_name, mime, signature) => {
    const alice = await createUser(t.db);
    const { body } = await requestUpload(alice, { kind: "photo", mime, bytes: 64 });
    const key = keyOf(alice.id, body.asset.id);
    storage.put("private", key, file(64, signature));
    expect((await complete(alice, body.asset.id)).status).toBe(422);
    expect(await t.db.select().from(assets).where(eq(assets.id, body.asset.id))).toEqual([]);
    expect(storage.has("private", key)).toBe(false);
  });

  it("queues the object for deletion when storage refuses to remove a rejected file", async () => {
    const alice = await createUser(t.db);
    const { body } = await requestUpload(alice);
    const key = keyOf(alice.id, body.asset.id);
    storage.put("private", key, file(64, [0x3c, 0x73, 0x76, 0x67]));
    storage.failRemove.add(key);
    expect((await complete(alice, body.asset.id)).status).toBe(422);
    const queued = await t.db.select().from(storageDeletions).where(eq(storageDeletions.storageKey, key));
    expect(queued).toMatchObject([{ bucket: "private", storageKey: key, attempts: 0 }]);
  });

  it("answers 404 for someone else's asset and for malformed ids", async () => {
    const alice = await createUser(t.db);
    const bob = await createUser(t.db);
    const { body } = await requestUpload(alice);
    storage.put("private", keyOf(alice.id, body.asset.id), file(64));
    expect((await complete(bob, body.asset.id)).status).toBe(404);
    expect((await complete(alice, "not-a-uuid")).status).toBe(404);
  });

  it.each([{ width: 0, height: 10 }, { width: 10, height: 16_385 }, { width: 10 }, { width: 10, height: 10, status: "ready" }])("rejects dimensions %j with 400", async (dims) => {
    const alice = await createUser(t.db);
    const { body } = await requestUpload(alice);
    expect((await call(h.complete, { method: "POST", as: alice, params: { id: body.asset.id }, body: dims })).status).toBe(400);
  });
});
```

- [ ] **Step 2: Run to verify it fails.**
Run: `corepack pnpm --filter @vash/web exec vitest run src/server/assets/uploads.test.ts`
Expected: FAIL with "Cannot find module './handlers'".

- [ ] **Step 3: Implement the repository additions.** Append to `apps/web/src/server/assets/repository.ts`, merging the drizzle import with the existing one:
```ts
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { assets } from "../db/schema";

export type AssetRow = typeof assets.$inferSelect;

export const assetKey = (ownerId: string, assetId: string) => `u/${ownerId}/${assetId}`;

export async function insertPendingAsset(
  db: Db,
  v: { id: string; ownerId: string; kind: "photo" | "thumbnail"; mime: AssetRow["mime"]; bytes: number; now: Date },
): Promise<AssetRow> {
  const [row] = await db
    .insert(assets)
    .values({ id: v.id, ownerId: v.ownerId, kind: v.kind, mime: v.mime, bytes: v.bytes, storageKey: assetKey(v.ownerId, v.id), createdAt: v.now, updatedAt: v.now })
    .returning();
  return row!;
}

export async function getOwnedAsset(db: Db, ownerId: string, id: string): Promise<AssetRow | undefined> {
  const [row] = await db.select().from(assets).where(and(eq(assets.id, id), eq(assets.ownerId, ownerId)));
  return row;
}

export async function markAssetReady(db: Db, ownerId: string, id: string, dims: { width: number; height: number }, now: Date): Promise<AssetRow | undefined> {
  const [row] = await db
    .update(assets)
    .set({ status: "ready", width: dims.width, height: dims.height, updatedAt: now })
    .where(and(eq(assets.id, id), eq(assets.ownerId, ownerId), eq(assets.status, "pending")))
    .returning();
  return row;
}

/** Bytes counted against the quota: pending uploads included, so a burst of requests can't overshoot it. */
export async function storageUsedBytes(db: Db, ownerId: string): Promise<number> {
  const [row] = await db.select({ used: sql<string>`coalesce(sum(${assets.bytes}), 0)` }).from(assets).where(eq(assets.ownerId, ownerId));
  return Number(row?.used ?? 0);
}
```

- [ ] **Step 4: Implement the service and handlers.**

`apps/web/src/server/assets/service.ts`:
```ts
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { assets, storageDeletions, user } from "../db/schema";
import type { Db } from "../db/types";
import { conflict, notFound, unprocessable } from "../http/problem";
import type { ObjectStorage } from "../storage/types";
import { getOwnedAsset, insertPendingAsset, markAssetReady, storageUsedBytes, type AssetRow } from "./repository";
import { SNIFF_BYTES, sniffImageMime } from "./sniff";

const MB = 1024 * 1024;

/** Spec §9.4. */
export const UPLOAD_LIMITS = {
  maxBytes: 15 * MB,
  storageQuotaBytes: 500 * MB,
  uploadUrlSeconds: 300,
  downloadUrlSeconds: 3600,
  maxDimension: 16_384,
} as const;

export const UPLOAD_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;
export type UploadMime = (typeof UPLOAD_MIMES)[number];

export interface AssetContext {
  db: Db;
  now: () => Date;
  storage: ObjectStorage;
}

export const toAssetJson = (a: AssetRow) => ({
  id: a.id,
  kind: a.kind,
  mime: a.mime,
  bytes: a.bytes,
  width: a.width,
  height: a.height,
  status: a.status,
  visibility: a.visibility,
  createdAt: a.createdAt.toISOString(),
});

export async function requestUpload(ctx: AssetContext, ownerId: string, input: { kind: "photo" | "thumbnail"; mime: UploadMime; bytes: number }) {
  const now = ctx.now();
  const asset = await ctx.db.transaction(async (tx) => {
    // Same row lock as quotas.ts, so two concurrent requests can't both fit under the quota.
    await tx.select({ id: user.id }).from(user).where(eq(user.id, ownerId)).for("no key update");
    const used = await storageUsedBytes(tx, ownerId);
    if (used + input.bytes > UPLOAD_LIMITS.storageQuotaBytes) {
      throw unprocessable("This upload would go over your 500 MB of storage. Delete some photos to make room.", {
        limitBytes: UPLOAD_LIMITS.storageQuotaBytes,
        usedBytes: used,
      });
    }
    return insertPendingAsset(tx, { id: randomUUID(), ownerId, kind: input.kind, mime: input.mime, bytes: input.bytes, now });
  });
  const url = await ctx.storage.presignUpload("private", asset.storageKey, {
    contentType: input.mime,
    contentLength: input.bytes,
    expiresInSeconds: UPLOAD_LIMITS.uploadUrlSeconds,
  });
  return {
    asset,
    upload: {
      url,
      method: "PUT" as const,
      headers: { "content-type": input.mime },
      expiresAt: new Date(now.getTime() + UPLOAD_LIMITS.uploadUrlSeconds * 1000).toISOString(),
    },
  };
}

/** Removes the row now; removes the object now, or queues it if storage is unavailable. */
export async function discardAsset(ctx: AssetContext, asset: AssetRow): Promise<void> {
  await ctx.db.delete(assets).where(eq(assets.id, asset.id));
  try {
    await ctx.storage.remove(asset.visibility, asset.storageKey);
  } catch {
    await ctx.db.insert(storageDeletions).values({ bucket: asset.visibility, storageKey: asset.storageKey, createdAt: ctx.now() });
  }
}

export async function completeUpload(ctx: AssetContext, ownerId: string, id: string, dims: { width: number; height: number }): Promise<AssetRow> {
  const asset = await getOwnedAsset(ctx.db, ownerId, id);
  if (!asset) throw notFound();
  if (asset.status === "ready") return asset;

  const head = await ctx.storage.head("private", asset.storageKey);
  if (!head) throw conflict("The file hasn't been uploaded yet. Upload it with the URL you were given, then try again.");

  if (head.contentLength !== asset.bytes) {
    await discardAsset(ctx, asset);
    throw unprocessable("The uploaded file's size doesn't match what was declared. Start the upload again.");
  }
  const sniffed = sniffImageMime(await ctx.storage.readPrefix("private", asset.storageKey, SNIFF_BYTES));
  if (sniffed !== asset.mime) {
    await discardAsset(ctx, asset);
    throw unprocessable("That file isn't the JPEG, PNG or WebP image it claimed to be.");
  }
  const ready = await markAssetReady(ctx.db, ownerId, id, dims, ctx.now());
  // A concurrent complete may have won the update; the asset is ready either way.
  return ready ?? (await getOwnedAsset(ctx.db, ownerId, id)) ?? asset;
}
```

`apps/web/src/server/assets/handlers.ts`:
```ts
import { z } from "zod";
import type { Deps } from "../deps";
import { readJson } from "../http/body";
import { endpoint } from "../http/endpoint";
import { parseId } from "../http/ids";
import { HttpError } from "../http/problem";
import { RATE_LIMITS } from "../rate-limit/rules";
import type { ObjectStorage } from "../storage/types";
import * as service from "./service";

const UploadBody = z
  .object({
    kind: z.enum(["photo", "thumbnail"]),
    mime: z.enum(service.UPLOAD_MIMES),
    bytes: z.number().int().min(1).max(service.UPLOAD_LIMITS.maxBytes),
  })
  .strict();

const Dimension = z.number().int().min(1).max(service.UPLOAD_LIMITS.maxDimension);
const CompleteBody = z.object({ width: Dimension, height: Dimension }).strict();

export function assetHandlers(deps: Deps, storage: ObjectStorage | null) {
  const ctx = (): service.AssetContext => {
    if (!storage) throw new HttpError(503, "Service Unavailable", "Photo storage isn't configured on this server.");
    return { db: deps.db, now: deps.now, storage };
  };
  return {
    requestUpload: endpoint(deps, { auth: "user", rateLimit: { name: "uploadUrl", rule: RATE_LIMITS.uploadUrl, by: "user" } }, async ({ req, user }) => {
      const c = ctx();
      const body = await readJson(req, UploadBody);
      const { asset, upload } = await service.requestUpload(c, user.id, body);
      return Response.json({ asset: service.toAssetJson(asset), upload }, { status: 201 });
    }),

    complete: endpoint(deps, { auth: "user" }, async ({ req, user, params }) => {
      const c = ctx();
      const id = parseId(params.id);
      const body = await readJson(req, CompleteBody);
      return Response.json(service.toAssetJson(await service.completeUpload(c, user.id, id, body)));
    }),
  };
}
```

Route files:

`apps/web/src/app/api/assets/uploads/route.ts`:
```ts
import { route } from "@/server/context";

export const POST = route((app) => app.assets.requestUpload);
```

`apps/web/src/app/api/assets/[id]/complete/route.ts`:
```ts
import { route } from "@/server/context";

export const POST = route((app) => app.assets.complete);
```

In `apps/web/src/server/context.ts`:
- import `assetHandlers` from `./assets/handlers` and `s3Storage` from `./storage/s3`;
- in `build()`, after `deps`, add `const storage = config.storage ? s3Storage(config.storage) : null;`;
- add `assets: assetHandlers(deps, storage),` to the returned object.

- [ ] **Step 5: Run tests, typecheck, lint.**
Run: `corepack pnpm --filter @vash/web exec vitest run src/server/assets && corepack pnpm --filter @vash/web typecheck && corepack pnpm --filter @vash/web lint`
Expected: PASS.

- [ ] **Step 6: Commit.**
```bash
git add apps/web/src/server/assets apps/web/src/app/api/assets apps/web/src/server/context.ts
git commit -m "feat(web): presigned photo uploads with size and file-signature verification and a 500 MB quota"
```

---

### Task 5: List, resolve and delete assets

**Files:**
- Modify: `apps/web/src/server/assets/repository.ts`, `apps/web/src/server/assets/service.ts`, `apps/web/src/server/assets/handlers.ts`
- Create: `apps/web/src/app/api/assets/route.ts`, `apps/web/src/app/api/assets/resolve/route.ts`, `apps/web/src/app/api/assets/[id]/route.ts`
- Test: `apps/web/src/server/assets/library.test.ts`

**Interfaces:**
- Consumes: Task 4 (`AssetContext`, `discardAsset`, `toAssetJson`, `getOwnedAsset`, `UPLOAD_LIMITS`), `pageQuery`, `decodeCursor`, `toPage`, `readQuery`, `LIMITS.assets` (from `@vash/schema`), `RATE_LIMITS.publicRead`
- Produces:
  ```ts
  listReadyAssets(db, ownerId, q: { kind?: "photo" | "thumbnail" | "sticker"; cursor?: Cursor; limit: number }): Promise<AssetRow[]>   // limit + 1 rows
  findResolvableAssets(db, viewerId: string | null, ids: string[]): Promise<AssetRow[]>
  resolveAssets(ctx, viewerId, ids): Promise<{ id: string; url: string; expiresAt: string | null }[]>
  assetHandlers(...).list / .resolve / .remove
  ```
- Rules:
  - A viewer may resolve a ready asset if they own it, if it has no owner (system asset), or if it is public.
  - Private assets get a presigned GET valid for 1 hour. Public assets get their CDN URL, with `expiresAt: null`.
  - Deleting an asset removes it from the caller's library. Designs that used it show the engine's "missing photo" state (spec §11.2), and a thumbnail reference becomes null through the foreign key. Plan 3 will make published template photos system-owned copies, so an author deleting their original never breaks a live template.

- [ ] **Step 1: Write the failing tests.**

`apps/web/src/server/assets/library.test.ts`:
```ts
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../../tests/support/db";
import { testDeps, tickingClock } from "../../../tests/support/deps";
import { emptyDoc } from "../../../tests/support/docs";
import { createAsset, createUser } from "../../../tests/support/factories";
import { call } from "../../../tests/support/invoke";
import { memoryStorage } from "../../../tests/support/storage";
import { assets, designs, storageDeletions } from "../db/schema";
import { assetHandlers } from "./handlers";

let t: TestDb;
let storage: ReturnType<typeof memoryStorage>;
let h: ReturnType<typeof assetHandlers>;
beforeAll(async () => {
  t = await createTestDb();
  storage = memoryStorage();
  h = assetHandlers(testDeps(t.db, { now: tickingClock() }), storage);
});
afterAll(() => t.close());

const resolve = (viewer: { id: string } | null, ids: unknown) => call(h.resolve, { method: "POST", as: viewer, body: { ids } });

describe("GET /api/assets", () => {
  it("lists only the caller's ready assets, newest first, filtered by kind and paginated", async () => {
    const alice = await createUser(t.db);
    const bob = await createUser(t.db);
    const older = await createAsset(t.db, { ownerId: alice.id, createdAt: new Date("2026-09-01T00:00:00Z") });
    const newer = await createAsset(t.db, { ownerId: alice.id, createdAt: new Date("2026-09-02T00:00:00Z") });
    await createAsset(t.db, { ownerId: alice.id, kind: "thumbnail" });
    await createAsset(t.db, { ownerId: alice.id, status: "pending" });
    await createAsset(t.db, { ownerId: bob.id });

    const first = await call(h.list, { as: alice, path: "/api/assets?kind=photo&limit=1" });
    expect(first.body.items.map((a: { id: string }) => a.id)).toEqual([newer.id]);
    const second = await call(h.list, { as: alice, path: `/api/assets?kind=photo&limit=1&cursor=${first.body.nextCursor}` });
    expect(second.body).toMatchObject({ items: [{ id: older.id }], nextCursor: null });
    expect((await call(h.list, { as: alice, path: "/api/assets?kind=video" })).status).toBe(400);
    expect((await call(h.list)).status).toBe(401);
  });
});

describe("POST /api/assets/resolve", () => {
  it("signs the caller's private assets for an hour and links public and system assets", async () => {
    const alice = await createUser(t.db);
    const own = await createAsset(t.db, { ownerId: alice.id });
    const pub = await createAsset(t.db, { ownerId: alice.id, visibility: "public" });
    const system = await createAsset(t.db, { ownerId: null, visibility: "public", kind: "sticker" });
    const res = await resolve(alice, [own.id, pub.id, system.id]);
    expect(res.status).toBe(200);
    const byId = Object.fromEntries(res.body.assets.map((a: { id: string }) => [a.id, a]));
    expect(byId[own.id].url).toBe(`https://storage.test/private/${own.storageKey}?op=get&expires=3600`);
    expect(new Date(byId[own.id].expiresAt).toISOString()).toBe(byId[own.id].expiresAt);
    expect(byId[pub.id]).toEqual({ id: pub.id, url: `https://cdn.test/${pub.storageKey}`, expiresAt: null });
    expect(byId[system.id].url).toBe(`https://cdn.test/${system.storageKey}`);
  });

  it("silently omits foreign, pending, unknown and duplicate ids", async () => {
    const alice = await createUser(t.db);
    const bob = await createUser(t.db);
    const own = await createAsset(t.db, { ownerId: alice.id });
    const bobs = await createAsset(t.db, { ownerId: bob.id });
    const pending = await createAsset(t.db, { ownerId: alice.id, status: "pending" });
    const res = await resolve(alice, [own.id, own.id, bobs.id, pending.id, "00000000-0000-4000-8000-000000000000"]);
    expect(res.body.assets.map((a: { id: string }) => a.id)).toEqual([own.id]);
  });

  it("lets guests resolve public and system assets only", async () => {
    const alice = await createUser(t.db);
    const priv = await createAsset(t.db, { ownerId: alice.id });
    const pub = await createAsset(t.db, { ownerId: alice.id, visibility: "public" });
    const res = await resolve(null, [priv.id, pub.id]);
    expect(res.body.assets.map((a: { id: string }) => a.id)).toEqual([pub.id]);
  });

  it.each([[[]], [["not-a-uuid"]], [Array.from({ length: 201 }, () => "00000000-0000-4000-8000-000000000000")], ["one"]])("rejects ids %# with 400", async (ids) => {
    const alice = await createUser(t.db);
    expect((await resolve(alice, ids)).status).toBe(400);
  });
});

describe("DELETE /api/assets/:id", () => {
  it("removes the caller's asset and its object, and clears design thumbnails", async () => {
    const alice = await createUser(t.db);
    const asset = await createAsset(t.db, { ownerId: alice.id });
    storage.put("private", asset.storageKey, new Uint8Array([1]));
    const [design] = await t.db.insert(designs).values({ ownerId: alice.id, title: "Card", doc: emptyDoc(), thumbnailAssetId: asset.id }).returning();
    expect((await call(h.remove, { method: "DELETE", as: alice, params: { id: asset.id } })).status).toBe(204);
    expect(await t.db.select().from(assets).where(eq(assets.id, asset.id))).toEqual([]);
    expect(storage.has("private", asset.storageKey)).toBe(false);
    const [after] = await t.db.select().from(designs).where(eq(designs.id, design!.id));
    expect(after?.thumbnailAssetId).toBeNull();
  });

  it("queues the object when storage is down, and answers 404 for anyone else's asset", async () => {
    const alice = await createUser(t.db);
    const bob = await createUser(t.db);
    const asset = await createAsset(t.db, { ownerId: alice.id, visibility: "public" });
    expect((await call(h.remove, { method: "DELETE", as: bob, params: { id: asset.id } })).status).toBe(404);
    storage.failRemove.add(asset.storageKey);
    expect((await call(h.remove, { method: "DELETE", as: alice, params: { id: asset.id } })).status).toBe(204);
    expect(await t.db.select().from(storageDeletions).where(eq(storageDeletions.storageKey, asset.storageKey))).toMatchObject([{ bucket: "public" }]);
  });
});
```

- [ ] **Step 2: Run to verify it fails.**
Run: `corepack pnpm --filter @vash/web exec vitest run src/server/assets/library.test.ts`
Expected: FAIL (`h.list`, `h.resolve` and `h.remove` are undefined).

- [ ] **Step 3: Implement.** Append to `apps/web/src/server/assets/repository.ts`, adding `desc` to the drizzle import and `import type { Cursor } from "../http/cursor";`:
```ts
export function listReadyAssets(db: Db, ownerId: string, q: { kind?: AssetRow["kind"]; cursor?: Cursor; limit: number }): Promise<AssetRow[]> {
  return db
    .select()
    .from(assets)
    .where(
      and(
        eq(assets.ownerId, ownerId),
        eq(assets.status, "ready"),
        q.kind ? eq(assets.kind, q.kind) : undefined,
        q.cursor ? sql`(${assets.createdAt}, ${assets.id}) < (${q.cursor.at}::timestamptz, ${q.cursor.id}::uuid)` : undefined,
      ),
    )
    .orderBy(desc(assets.createdAt), desc(assets.id))
    .limit(q.limit + 1);
}

/** Ready assets the viewer may see: their own, system-owned, or public. Guests (null) see only the latter two. */
export function findResolvableAssets(db: Db, viewerId: string | null, ids: string[]): Promise<AssetRow[]> {
  return db
    .select()
    .from(assets)
    .where(
      and(
        inArray(assets.id, ids),
        eq(assets.status, "ready"),
        or(isNull(assets.ownerId), eq(assets.visibility, "public"), viewerId ? eq(assets.ownerId, viewerId) : undefined),
      ),
    );
}
```

Append to `apps/web/src/server/assets/service.ts`, adding `findResolvableAssets` to the repository import:
```ts
export async function resolveAssets(ctx: AssetContext, viewerId: string | null, ids: string[]) {
  const rows = await findResolvableAssets(ctx.db, viewerId, [...new Set(ids)]);
  const expiresAt = new Date(ctx.now().getTime() + UPLOAD_LIMITS.downloadUrlSeconds * 1000).toISOString();
  return Promise.all(
    rows.map(async (a) =>
      a.visibility === "public"
        ? { id: a.id, url: ctx.storage.publicUrl(a.storageKey), expiresAt: null }
        : { id: a.id, url: await ctx.storage.presignDownload("private", a.storageKey, UPLOAD_LIMITS.downloadUrlSeconds), expiresAt },
    ),
  );
}
```

In `apps/web/src/server/assets/handlers.ts`:
- add imports:
  ```ts
  import { LIMITS } from "@vash/schema";
  import { readQuery } from "../http/body";
  import { decodeCursor, pageQuery, toPage } from "../http/cursor";
  import { notFound } from "../http/problem";
  import { getOwnedAsset, listReadyAssets } from "./repository";
  ```
  (merge `readQuery` into the existing `../http/body` import, and `notFound` into the existing `../http/problem` import);
- add the schemas:
  ```ts
  const ListQuery = pageQuery.extend({ kind: z.enum(["photo", "thumbnail", "sticker"]).optional() });
  const ResolveBody = z.object({ ids: z.array(z.uuid()).min(1).max(LIMITS.assets) }).strict();
  ```
- add three handlers to the returned object:
  ```ts
    list: endpoint(deps, { auth: "user" }, async ({ req, user }) => {
      const q = readQuery(req, ListQuery);
      const rows = await listReadyAssets(deps.db, user.id, { kind: q.kind, cursor: q.cursor ? decodeCursor(q.cursor) : undefined, limit: q.limit });
      return Response.json(toPage(rows, q.limit, (r) => ({ at: r.createdAt.toISOString(), id: r.id }), service.toAssetJson));
    }),

    resolve: endpoint(deps, { auth: "optional", rateLimit: { name: "assetResolve", rule: RATE_LIMITS.publicRead, by: "user" } }, async ({ req, user }) => {
      const c = ctx();
      const body = await readJson(req, ResolveBody);
      return Response.json({ assets: await service.resolveAssets(c, user?.id ?? null, body.ids.map((id) => id.toLowerCase())) });
    }),

    remove: endpoint(deps, { auth: "user" }, async ({ user, params }) => {
      const c = ctx();
      const asset = await getOwnedAsset(deps.db, user.id, parseId(params.id));
      if (!asset) throw notFound();
      await service.discardAsset(c, asset);
      return new Response(null, { status: 204 });
    }),
  ```

The list doesn't touch storage, so it keeps working without it. Resolve and remove both need storage.

Route files:

`apps/web/src/app/api/assets/route.ts`:
```ts
import { route } from "@/server/context";

export const GET = route((app) => app.assets.list);
```

`apps/web/src/app/api/assets/resolve/route.ts`:
```ts
import { route } from "@/server/context";

export const POST = route((app) => app.assets.resolve);
```

`apps/web/src/app/api/assets/[id]/route.ts`:
```ts
import { route } from "@/server/context";

export const DELETE = route((app) => app.assets.remove);
```

- [ ] **Step 4: Run tests, typecheck, lint.**
Run: `corepack pnpm --filter @vash/web exec vitest run src/server/assets && corepack pnpm --filter @vash/web typecheck && corepack pnpm --filter @vash/web lint`
Expected: PASS.

- [ ] **Step 5: Commit.**
```bash
git add apps/web/src/server/assets apps/web/src/app/api/assets
git commit -m "feat(web): media library list, signed asset resolution and asset deletion"
```

---

### Task 6: Storage-deletion outbox

**Files:**
- Create: `apps/web/src/server/storage/outbox.ts`
- Test: `apps/web/src/server/storage/outbox.test.ts`

**Interfaces:**
- Consumes: `ObjectStorage`, `storageDeletions` table
- Produces: `OUTBOX = { batchSize: 50, maxAttempts: 5 }`, `processStorageDeletions(db: Db, storage: ObjectStorage, batchSize?: number): Promise<{ deleted: number; failed: number }>`

- [ ] **Step 1: Write the failing test.**

`apps/web/src/server/storage/outbox.test.ts`:
```ts
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeEach, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../../tests/support/db";
import { memoryStorage } from "../../../tests/support/storage";
import { storageDeletions } from "../db/schema";
import { OUTBOX, processStorageDeletions } from "./outbox";

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
beforeEach(async () => {
  await t.db.delete(storageDeletions);
});
afterAll(() => t.close());

const queue = (storageKey: string, extra: Partial<typeof storageDeletions.$inferInsert> = {}) =>
  t.db.insert(storageDeletions).values({ bucket: "private", storageKey, ...extra });

describe("processStorageDeletions", () => {
  it("removes queued objects and their rows", async () => {
    const storage = memoryStorage();
    storage.put("private", "u/a/1", new Uint8Array([1]));
    await queue("u/a/1");
    await queue("u/a/already-gone");
    expect(await processStorageDeletions(t.db, storage)).toEqual({ deleted: 2, failed: 0 });
    expect(storage.has("private", "u/a/1")).toBe(false);
    expect(await t.db.select().from(storageDeletions)).toEqual([]);
  });

  it("keeps failures for a retry, and gives up after the maximum attempts", async () => {
    const storage = memoryStorage();
    storage.failRemove.add("u/a/stuck");
    await queue("u/a/stuck");
    for (let i = 0; i < OUTBOX.maxAttempts; i++) await processStorageDeletions(t.db, storage);
    const [row] = await t.db.select().from(storageDeletions).where(eq(storageDeletions.storageKey, "u/a/stuck"));
    expect(row?.attempts).toBe(OUTBOX.maxAttempts);
    expect(await processStorageDeletions(t.db, storage)).toEqual({ deleted: 0, failed: 0 });
  });

  it("works oldest first, in batches", async () => {
    const storage = memoryStorage();
    await queue("u/a/new", { createdAt: new Date("2026-09-26T00:00:00Z") });
    await queue("u/a/old", { createdAt: new Date("2026-09-01T00:00:00Z") });
    expect(await processStorageDeletions(t.db, storage, 1)).toEqual({ deleted: 1, failed: 0 });
    const left = await t.db.select().from(storageDeletions).orderBy(asc(storageDeletions.createdAt));
    expect(left.map((r) => r.storageKey)).toEqual(["u/a/new"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails.**
Run: `corepack pnpm --filter @vash/web exec vitest run src/server/storage/outbox.test.ts`
Expected: FAIL with "Cannot find module './outbox'".

- [ ] **Step 3: Implement.**

`apps/web/src/server/storage/outbox.ts`:
```ts
import { asc, eq, lt, sql } from "drizzle-orm";
import { storageDeletions } from "../db/schema";
import type { Db } from "../db/types";
import type { ObjectStorage } from "./types";

export const OUTBOX = { batchSize: 50, maxAttempts: 5 } as const;

/**
 * Deletes queued objects, oldest first. Removal is idempotent, so overlapping runs are harmless.
 * Rows that keep failing stop being retried after OUTBOX.maxAttempts and stay for inspection.
 */
export async function processStorageDeletions(db: Db, storage: ObjectStorage, batchSize: number = OUTBOX.batchSize) {
  const rows = await db
    .select()
    .from(storageDeletions)
    .where(lt(storageDeletions.attempts, OUTBOX.maxAttempts))
    .orderBy(asc(storageDeletions.createdAt), asc(storageDeletions.id))
    .limit(batchSize);
  let deleted = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      await storage.remove(row.bucket, row.storageKey);
      await db.delete(storageDeletions).where(eq(storageDeletions.id, row.id));
      deleted++;
    } catch {
      await db.update(storageDeletions).set({ attempts: sql`${storageDeletions.attempts} + 1` }).where(eq(storageDeletions.id, row.id));
      failed++;
    }
  }
  return { deleted, failed };
}
```

- [ ] **Step 4: Run to verify it passes.**
Run: `corepack pnpm --filter @vash/web exec vitest run src/server/storage/outbox.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit.**
```bash
git add apps/web/src/server/storage/outbox.ts apps/web/src/server/storage/outbox.test.ts
git commit -m "feat(web): drain the storage-deletion outbox with bounded retries"
```

---

### Task 7: Scheduled cleanup endpoint

**Files:**
- Create: `apps/web/src/server/cron/cleanup.ts`, `apps/web/src/server/cron/handlers.ts`, `apps/web/src/app/api/cron/cleanup/route.ts`, `apps/web/vercel.json`
- Modify: `apps/web/src/server/context.ts`
- Test: `apps/web/src/server/cron/cleanup.test.ts`

**Interfaces:**
- Consumes: `processStorageDeletions`, `ObjectStorage`, and the `assets`, `rateLimits`, `session`, `verification` and `storageDeletions` tables
- Produces:
  ```ts
  CLEANUP = { pendingUploadMaxAgeMs: 24h, rateLimitRetentionMs: 2 days }
  runCleanup(db, storage: ObjectStorage | null, now: Date): Promise<CleanupResult>
  type CleanupResult = { pendingUploadsPurged; rateLimitWindowsDeleted; verificationsDeleted; sessionsDeleted; storageDeleted; storageFailed }   // all numbers
  cronHandlers(deps: Deps, storage: ObjectStorage | null, cronSecret: string | null): { cleanup: Handler }
  ```

- [ ] **Step 1: Write the failing tests.**

`apps/web/src/server/cron/cleanup.test.ts`:
```ts
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../../tests/support/db";
import { testDeps } from "../../../tests/support/deps";
import { createAsset, createUser } from "../../../tests/support/factories";
import { call } from "../../../tests/support/invoke";
import { memoryStorage } from "../../../tests/support/storage";
import { assets, rateLimits, session, storageDeletions, verification } from "../db/schema";
import { cronHandlers } from "./handlers";

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(() => t.close());

const SECRET = "cron-secret-that-is-at-least-32-characters";
const NOW = new Date("2026-09-26T03:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

describe("GET /api/cron/cleanup", () => {
  it("refuses requests without the right bearer token, or when no secret is configured", async () => {
    const h = cronHandlers(testDeps(t.db), memoryStorage(), SECRET);
    expect((await call(h.cleanup)).status).toBe(401);
    expect((await call(h.cleanup, { headers: { authorization: `Bearer ${SECRET}x` } })).status).toBe(401);
    expect((await call(h.cleanup, { headers: { authorization: SECRET } })).status).toBe(401);
    const unconfigured = cronHandlers(testDeps(t.db), memoryStorage(), null);
    expect((await call(unconfigured.cleanup, { headers: { authorization: "Bearer " } })).status).toBe(401);
  });

  it("purges stale uploads, old windows, expired sign-in rows and drains the outbox, idempotently", async () => {
    const storage = memoryStorage();
    const owner = await createUser(t.db);
    const stale = await createAsset(t.db, { ownerId: owner.id, status: "pending", createdAt: hoursAgo(25) });
    const fresh = await createAsset(t.db, { ownerId: owner.id, status: "pending", createdAt: hoursAgo(1) });
    const oldReady = await createAsset(t.db, { ownerId: owner.id, createdAt: hoursAgo(500) });
    storage.put("private", stale.storageKey, new Uint8Array([1]));
    await t.db.insert(rateLimits).values([
      { key: "old", windowStart: hoursAgo(72), count: 1 },
      { key: "recent", windowStart: hoursAgo(1), count: 1 },
    ]);
    await t.db.insert(verification).values([
      { id: "v-old", identifier: "x", value: "y", expiresAt: hoursAgo(1) },
      { id: "v-live", identifier: "x", value: "y", expiresAt: new Date(NOW.getTime() + 60_000) },
    ]);
    await t.db.insert(session).values([
      { id: "s-old", token: "t-old", userId: owner.id, expiresAt: hoursAgo(1) },
      { id: "s-live", token: "t-live", userId: owner.id, expiresAt: new Date(NOW.getTime() + 60_000) },
    ]);

    const h = cronHandlers(testDeps(t.db, { now: () => NOW }), storage, SECRET);
    const first = await call(h.cleanup, { headers: { authorization: `Bearer ${SECRET}` } });
    expect(first.status).toBe(200);
    expect(first.body).toEqual({
      pendingUploadsPurged: 1,
      rateLimitWindowsDeleted: 1,
      verificationsDeleted: 1,
      sessionsDeleted: 1,
      storageDeleted: 1,
      storageFailed: 0,
    });
    expect(storage.has("private", stale.storageKey)).toBe(false);
    const left = (await t.db.select({ id: assets.id }).from(assets)).map((a) => a.id);
    expect(left).toEqual(expect.arrayContaining([fresh.id, oldReady.id]));
    expect(left).not.toContain(stale.id);
    expect(await t.db.select().from(rateLimits).where(eq(rateLimits.key, "recent"))).toHaveLength(1);
    expect(await t.db.select().from(verification).where(eq(verification.id, "v-live"))).toHaveLength(1);
    expect(await t.db.select().from(session).where(eq(session.id, "s-live"))).toHaveLength(1);

    const second = await call(h.cleanup, { headers: { authorization: `Bearer ${SECRET}` } });
    expect(second.body).toMatchObject({ pendingUploadsPurged: 0, rateLimitWindowsDeleted: 0, storageDeleted: 0 });
  });

  it("still cleans the database when storage isn't configured, keeping the outbox for later", async () => {
    const owner = await createUser(t.db);
    const stale = await createAsset(t.db, { ownerId: owner.id, status: "pending", createdAt: hoursAgo(30) });
    const h = cronHandlers(testDeps(t.db, { now: () => NOW }), null, SECRET);
    const res = await call(h.cleanup, { headers: { authorization: `Bearer ${SECRET}` } });
    expect(res.body).toMatchObject({ pendingUploadsPurged: 1, storageDeleted: 0 });
    expect(await t.db.select().from(storageDeletions).where(eq(storageDeletions.storageKey, stale.storageKey))).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails.**
Run: `corepack pnpm --filter @vash/web exec vitest run src/server/cron`
Expected: FAIL with "Cannot find module './handlers'".

- [ ] **Step 3: Implement.**

`apps/web/src/server/cron/cleanup.ts`:
```ts
import { and, eq, lt } from "drizzle-orm";
import { assets, rateLimits, session, storageDeletions, verification } from "../db/schema";
import type { Db } from "../db/types";
import { processStorageDeletions } from "../storage/outbox";
import type { ObjectStorage } from "../storage/types";

const HOUR = 3_600_000;

/** Longest rate-limit window is a day (RATE_LIMITS); keep one extra day of history. */
export const CLEANUP = { pendingUploadMaxAgeMs: 24 * HOUR, rateLimitRetentionMs: 48 * HOUR } as const;

export type CleanupResult = Awaited<ReturnType<typeof runCleanup>>;

export async function runCleanup(db: Db, storage: ObjectStorage | null, now: Date) {
  const pendingCutoff = new Date(now.getTime() - CLEANUP.pendingUploadMaxAgeMs);
  const pendingUploadsPurged = await db.transaction(async (tx) => {
    const stale = await tx
      .delete(assets)
      .where(and(eq(assets.status, "pending"), lt(assets.createdAt, pendingCutoff)))
      .returning({ storageKey: assets.storageKey, visibility: assets.visibility });
    if (stale.length > 0) {
      await tx.insert(storageDeletions).values(stale.map((a) => ({ bucket: a.visibility, storageKey: a.storageKey, createdAt: now })));
    }
    return stale.length;
  });
  const windows = await db
    .delete(rateLimits)
    .where(lt(rateLimits.windowStart, new Date(now.getTime() - CLEANUP.rateLimitRetentionMs)))
    .returning({ key: rateLimits.key });
  const verifications = await db.delete(verification).where(lt(verification.expiresAt, now)).returning({ id: verification.id });
  const sessions = await db.delete(session).where(lt(session.expiresAt, now)).returning({ id: session.id });
  const outbox = storage ? await processStorageDeletions(db, storage) : { deleted: 0, failed: 0 };
  return {
    pendingUploadsPurged,
    rateLimitWindowsDeleted: windows.length,
    verificationsDeleted: verifications.length,
    sessionsDeleted: sessions.length,
    storageDeleted: outbox.deleted,
    storageFailed: outbox.failed,
  };
}
```

`apps/web/src/server/cron/handlers.ts`:
```ts
import { createHash, timingSafeEqual } from "node:crypto";
import type { Deps } from "../deps";
import { endpoint } from "../http/endpoint";
import { HttpError } from "../http/problem";
import type { ObjectStorage } from "../storage/types";
import { runCleanup } from "./cleanup";

/** Constant-time comparison of `Authorization: Bearer <secret>` (hashing equalises lengths). */
function bearerMatches(header: string | null, secret: string): boolean {
  const presented = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  return timingSafeEqual(createHash("sha256").update(presented).digest(), createHash("sha256").update(secret).digest());
}

export function cronHandlers(deps: Deps, storage: ObjectStorage | null, cronSecret: string | null) {
  return {
    cleanup: endpoint(deps, { auth: "none" }, async ({ req }) => {
      if (!cronSecret || !bearerMatches(req.headers.get("authorization"), cronSecret)) {
        throw new HttpError(401, "Unauthorized", "A valid cron token is required.");
      }
      const result = await runCleanup(deps.db, storage, deps.now());
      deps.logger.info("cron.cleanup", result);
      return Response.json(result);
    }),
  };
}
```

`apps/web/src/app/api/cron/cleanup/route.ts`:
```ts
import { route } from "@/server/context";

export const GET = route((app) => app.cron.cleanup);
```

`apps/web/vercel.json` (Vercel Hobby allows one run per day; spec §9.7 said hourly, see decision 28):
```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "crons": [{ "path": "/api/cron/cleanup", "schedule": "0 3 * * *" }]
}
```

In `apps/web/src/server/context.ts`, import `cronHandlers` from `./cron/handlers` and add `cron: cronHandlers(deps, storage, config.cronSecret),` to the returned object.

- [ ] **Step 4: Run tests, typecheck, lint.**
Run: `corepack pnpm --filter @vash/web exec vitest run src/server/cron && corepack pnpm --filter @vash/web typecheck && corepack pnpm --filter @vash/web lint`
Expected: PASS. If the `session` insert fails on missing columns, it's missing required fields: check `createdAt`/`updatedAt` defaults in `schema.ts` (both have `defaultNow()`, so it shouldn't).

- [ ] **Step 5: Commit.**
```bash
git add apps/web/src/server/cron apps/web/src/app/api/cron apps/web/vercel.json apps/web/src/server/context.ts
git commit -m "feat(web): daily cleanup of stale uploads, rate-limit windows, expired sign-in rows and the deletion outbox"
```

---

### Task 8: CSP for storage origins, documentation

**Files:**
- Modify: `apps/web/src/server/security/headers.ts`, `apps/web/src/server/security/headers.test.ts`, `apps/web/src/proxy.ts`, `apps/web/src/proxy.test.ts`
- Modify: `docs/decisions.md`, `docs/free-stack.md`

**Interfaces:**
- Produces: `buildCsp({ nonce, isDevelopment, storageOrigins?: string[] })`, and `storageOrigins(env): string[]` exported from `proxy.ts`

- [ ] **Step 1: Write the failing tests.**

Append to `apps/web/src/server/security/headers.test.ts`, inside `describe("buildCsp")`:
```ts
  it("allows images from and uploads to the storage origins only", () => {
    const csp = buildCsp({ nonce: "n", isDevelopment: false, storageOrigins: ["https://proj.supabase.co", "https://proj.storage.supabase.co"] });
    expect(csp).toContain("img-src 'self' blob: data: https://proj.supabase.co https://proj.storage.supabase.co");
    expect(csp).toContain("connect-src 'self' https://proj.supabase.co https://proj.storage.supabase.co");
  });
```

Append to `apps/web/src/proxy.test.ts`:
```ts
import { storageOrigins } from "./proxy";

describe("storageOrigins", () => {
  it("derives unique origins from the storage settings and ignores junk", () => {
    expect(
      storageOrigins({
        STORAGE_ENDPOINT: "https://proj.storage.supabase.co/storage/v1/s3",
        STORAGE_PUBLIC_BASE_URL: "https://proj.supabase.co/storage/v1/object/public/vash-public",
      }),
    ).toEqual(["https://proj.storage.supabase.co", "https://proj.supabase.co"]);
    expect(storageOrigins({ STORAGE_ENDPOINT: "not a url", STORAGE_PUBLIC_BASE_URL: "" })).toEqual([]);
    expect(storageOrigins({ STORAGE_ENDPOINT: "javascript:alert(1)" })).toEqual([]);
  });
});
```
(Merge the new import into the existing `./proxy` import.)

- [ ] **Step 2: Run to verify it fails.**
Run: `corepack pnpm --filter @vash/web exec vitest run src/proxy.test.ts src/server/security`
Expected: FAIL (the CSP lacks the origins; `storageOrigins` isn't exported).

- [ ] **Step 3: Implement.** In `apps/web/src/server/security/headers.ts`, change `buildCsp`'s signature and two directives:
```ts
export function buildCsp({ nonce, isDevelopment, storageOrigins = [] }: { nonce: string; isDevelopment: boolean; storageOrigins?: string[] }): string {
```
```ts
    ["img-src", "'self'", "blob:", "data:", ...storageOrigins],
```
```ts
    ["connect-src", "'self'", ...storageOrigins],
```
Delete the `/** Plan 2 adds the R2 origins to img-src and connect-src. */` comment.

In `apps/web/src/proxy.ts`, add and use:
```ts
/** https origins of the storage endpoints (browser PUTs and image loads); anything unparsable is ignored. */
export function storageOrigins(env: Record<string, string | undefined>): string[] {
  const origins = [env.STORAGE_ENDPOINT, env.STORAGE_PUBLIC_BASE_URL].flatMap((value) => {
    if (!value) return [];
    try {
      const url = new URL(value);
      return url.protocol === "https:" ? [url.origin] : [];
    } catch {
      return [];
    }
  });
  return [...new Set(origins)];
}
```
and change the CSP line in `proxy()` to:
```ts
  const csp = buildCsp({ nonce, isDevelopment: process.env.NODE_ENV === "development", storageOrigins: storageOrigins(process.env) });
```
The proxy reads `process.env` directly, not `loadConfig`, so pages still render when the rest of the configuration is incomplete.

Also note in the Plan 4 checklist, via the free-stack edit below: the Supabase buckets need a CORS rule allowing `PUT` from `APP_ORIGIN`.

- [ ] **Step 4: Update the docs.**

Append to the table in `docs/decisions.md`:
```markdown
| 27 | 2026-09-26 | **Photo storage is Supabase Storage through its S3 API** (presigned PUT/GET with SigV4, path-style), behind an `ObjectStorage` port. Two buckets: `vash-private` (uploads) and `vash-public` (published template photos, Plan 3). | Free tier with no card (R2 asks for one); the port keeps R2 or S3 a config change away. |
| 28 | 2026-09-26 | **Cleanup runs daily** (`vercel.json`, 03:00 UTC), not hourly as spec §9.7 said. Pending uploads older than 24 h, rate-limit windows older than 48 h, expired verifications and sessions are deleted; the outbox is drained 50 at a time with at most 5 attempts per object. | Vercel Hobby allows only daily cron jobs; nothing here needs faster turnover. |
| 29 | 2026-09-26 | **Upload rules:** users upload `photo` or `thumbnail` only (stickers are system assets); pending uploads count toward the 500 MB quota; a rejected upload's row is removed at once and its object removed or queued; users may delete their own assets (designs then show the missing-photo state). Plan 3 must make published template photos system-owned copies. | Blocks quota bursts and disguised files; deleting your own upload never breaks someone else's template. |
```

In `docs/free-stack.md`, move the "Photo storage | Supabase Storage free" line into the "In the app now" table:
```markdown
| Supabase Storage | Photo uploads (S3 API, presigned URLs) | `STORAGE_*` (S3 access keys) | 1 GB storage; buckets `vash-private` + `vash-public`, CORS: allow `PUT` and `GET` from your `APP_ORIGIN` |
```
and delete its row from the Hosting table, leaving a note that R2 asks for a card.

- [ ] **Step 5: Full verification.**
Run: `corepack pnpm -r --parallel lint && corepack pnpm -r typecheck && corepack pnpm -r test && corepack pnpm -r build`
Expected: all green. The build lists `ƒ /api/assets`, `ƒ /api/assets/[id]`, `ƒ /api/assets/[id]/complete`, `ƒ /api/assets/resolve`, `ƒ /api/assets/uploads` and `ƒ /api/cron/cleanup`.

- [ ] **Step 6: Commit.**
```bash
git add apps/web/src/server/security apps/web/src/proxy.ts apps/web/src/proxy.test.ts docs/decisions.md docs/free-stack.md
git commit -m "feat(web): allow the storage origins in the CSP; document storage and cron decisions"
```

---

## Self-Review Notes

- **Spec coverage:**
  - §9.4: steps 1–4 are Tasks 4 and 5, pending purge is Task 7, file-signature sniffing is Task 2.
  - §9.5 "Malicious uploads": MIME allowlist and no user SVG (Task 4 DTO), sniffing (Tasks 2 and 4), size limits and quota (Task 4), server-generated keys (`assetKey`), private bucket (uploads always go to `private`).
  - §9.6: upload URL 60/hour (Task 4). Resolve reuses `publicRead` 300/min.
  - §9.7: cron cleanup (Task 7, daily per decision 28).
  - §9.3 Assets row: all five endpoints (Tasks 4 and 5).
  - `storage_deletions` outbox (Task 6), already fed by account deletion (Plan 1).
  - CSP storage origins, which Plan 1 deferred (Task 8).
- **Deferred to Plan 3 on purpose:** copying kept photos to the public bucket at publish time (it needs `CopyObject` there, not here), and template thumbnails going public.
- **Type consistency:** `ObjectStorage`, `Bucket`, `AssetContext`, `UPLOAD_LIMITS`, `assetHandlers(deps, storage)` and `cronHandlers(deps, storage, cronSecret)` are named identically in every task.
- **Known uncertainty:** whether Supabase enforces the signed `content-length` on presigned PUTs. `complete` re-checks the size either way (Review Focus 1), so the guarantee doesn't depend on it.

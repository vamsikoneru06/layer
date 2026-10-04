import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { storedObjects } from "../db/schema";
import type { Db } from "../db/types";
import type { Bucket, ObjectStorage } from "./types";

const MB = 1024 * 1024;

/**
 * What the built-in storage allows each user. The free database tier this runs on is small (Neon's
 * is 0.5 GB for everything), so it's well under the 500 MB an external bucket allows.
 */
export const DATABASE_QUOTA_BYTES = 50 * MB;

type Grant = { op: "put"; b: Bucket; k: string; ct: string; len: number; exp: number } | { op: "get"; b: Bucket; k: string; exp: number };

/** Signs a short-lived grant for one operation on one object, with a key derived from the app secret. */
export function signGrant(secret: string, grant: Grant): string {
  const body = Buffer.from(JSON.stringify(grant)).toString("base64url");
  return `${body}.${mac(secret, body)}`;
}

/** The grant, if the token is authentic and unexpired; otherwise null. */
export function verifyGrant(secret: string, token: string, now: Date): Grant | null {
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return null;
  const expected = Buffer.from(mac(secret, body));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const grant = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Grant;
    return typeof grant.exp === "number" && grant.exp > now.getTime() ? grant : null;
  } catch {
    return null;
  }
}

function mac(secret: string, body: string): string {
  return createHmac("sha256", `vash-storage-v1:${secret}`).update(body).digest("base64url");
}

/**
 * Object storage kept in the app's own Postgres database, for when no S3-compatible bucket is set up.
 * Upload and download URLs point at this app (/api/storage/...) and carry a signed, expiring grant
 * for exactly one object, so they behave like presigned bucket URLs.
 */
export function databaseStorage(o: { db: Db; secret: string; origin: string; now: () => Date }): ObjectStorage {
  const { db } = o;
  const where = (bucket: Bucket, key: string) => and(eq(storedObjects.bucket, bucket), eq(storedObjects.key, key));
  const expires = (seconds: number) => o.now().getTime() + seconds * 1000;
  const head = async (bucket: Bucket, key: string) => {
    const [row] = await db.select({ size: storedObjects.size }).from(storedObjects).where(where(bucket, key));
    return row ? { contentLength: row.size } : null;
  };
  return {
    quotaBytes: DATABASE_QUOTA_BYTES,

    async presignUpload(bucket, key, u) {
      const token = signGrant(o.secret, { op: "put", b: bucket, k: key, ct: u.contentType, len: u.contentLength, exp: expires(u.expiresInSeconds) });
      return `${o.origin}/api/storage/objects?t=${token}`;
    },

    async presignDownload(bucket, key, seconds) {
      return `${o.origin}/api/storage/objects?t=${signGrant(o.secret, { op: "get", b: bucket, k: key, exp: expires(seconds) })}`;
    },

    publicUrl(key) {
      return `${o.origin}/api/storage/public/${key.split("/").map(encodeURIComponent).join("/")}`;
    },

    head,

    async readPrefix(bucket, key, length) {
      const [row] = await db
        .select({ data: sql<Uint8Array>`substring(${storedObjects.data} from 1 for ${length})` })
        .from(storedObjects)
        .where(where(bucket, key));
      if (!row) throw new Error(`no stored object ${bucket}/${key}`);
      return new Uint8Array(row.data);
    },

    async copy(from, to) {
      await db.execute(sql`
        insert into ${storedObjects} (bucket, key, content_type, size, data)
        select ${to.bucket}, ${to.key}, content_type, size, data from ${storedObjects}
        where bucket = ${from.bucket} and key = ${from.key}
        on conflict (bucket, key) do update set content_type = excluded.content_type, size = excluded.size, data = excluded.data`);
      if (!(await head(to.bucket, to.key))) throw new Error(`no stored object ${from.bucket}/${from.key} to copy`);
    },

    async remove(bucket, key) {
      await db.delete(storedObjects).where(where(bucket, key));
    },
  };
}

/** Writes an upload's bytes (the PUT a grant allows). */
export async function writeObject(db: Db, bucket: Bucket, key: string, contentType: string, data: Uint8Array): Promise<void> {
  await db
    .insert(storedObjects)
    .values({ bucket, key, contentType, size: data.byteLength, data })
    .onConflictDoUpdate({ target: [storedObjects.bucket, storedObjects.key], set: { contentType, size: data.byteLength, data } });
}

export async function readObject(db: Db, bucket: Bucket, key: string): Promise<{ contentType: string; data: Uint8Array } | null> {
  const [row] = await db
    .select({ contentType: storedObjects.contentType, data: storedObjects.data })
    .from(storedObjects)
    .where(and(eq(storedObjects.bucket, bucket), eq(storedObjects.key, key)));
  return row ?? null;
}

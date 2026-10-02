import type { Deps } from "../deps";
import { endpoint } from "../http/endpoint";
import { HttpError, notFound } from "../http/problem";
import { RATE_LIMITS } from "../rate-limit/rules";
import { readObject, verifyGrant, writeObject } from "./database";

const publicRead = { name: "publicRead", rule: RATE_LIMITS.publicRead, by: "ip" } as const;

/** Reads the request body, refusing anything longer than `limit` bytes before it's all buffered. */
async function readBody(req: Request, limit: number): Promise<Uint8Array> {
  const reader = req.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new HttpError(413, "Content Too Large", "The file is larger than the upload allows.");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

/**
 * The URLs the built-in database storage hands out. Every private operation needs a signed grant from
 * the API (the upload or resolve flow); only the public bucket is readable by path. When an external
 * bucket is configured instead, these answer 404.
 */
export function storageFileHandlers(deps: Deps, enabled: boolean) {
  const grant = (req: Request, op: "put" | "get") => {
    if (!enabled) throw notFound();
    const g = verifyGrant(deps.config.authSecret, new URL(req.url).searchParams.get("t") ?? "", deps.now());
    if (!g || g.op !== op) throw new HttpError(403, "Forbidden", "This link is invalid or has expired.");
    return g;
  };

  return {
    put: endpoint(deps, { auth: "none" }, async ({ req }) => {
      const g = grant(req, "put");
      if (g.op !== "put") throw notFound();
      if ((req.headers.get("content-type") ?? "").split(";")[0]!.trim() !== g.ct) {
        throw new HttpError(415, "Unsupported Media Type", "The file type doesn't match the upload.");
      }
      const data = await readBody(req, g.len);
      if (data.byteLength !== g.len) throw new HttpError(400, "Bad Request", "The file size doesn't match the upload.");
      await writeObject(deps.db, g.b, g.k, g.ct, data);
      return new Response(null, { status: 200 });
    }),

    get: endpoint(deps, { auth: "none" }, async ({ req }) => {
      const g = grant(req, "get");
      const obj = await readObject(deps.db, g.b, g.k);
      if (!obj) throw notFound();
      return new Response(obj.data as BodyInit, { headers: { "content-type": obj.contentType, "cache-control": "private, max-age=3600" } });
    }),

    getPublic: endpoint(deps, { auth: "none", rateLimit: publicRead }, async ({ req }) => {
      if (!enabled) throw notFound();
      let key: string;
      try {
        key = decodeURIComponent(new URL(req.url).pathname.replace(/^\/api\/storage\/public\//, ""));
      } catch {
        throw notFound(); // A malformed escape can't name a stored object.
      }
      const obj = await readObject(deps.db, "public", key);
      if (!obj) throw notFound();
      // Public keys are unique per asset and never rewritten, so they can be cached for good.
      return new Response(obj.data as BodyInit, { headers: { "content-type": obj.contentType, "cache-control": "public, max-age=31536000, immutable" } });
    }),
  };
}

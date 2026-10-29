import { z } from "zod";
import type { Deps } from "../deps";
import { readQuery } from "../http/body";
import { endpoint } from "../http/endpoint";
import { HttpError } from "../http/problem";
import { RATE_LIMITS } from "../rate-limit/rules";
import { isPexelsImage, PexelsError, type PexelsClient } from "./pexels";

const SearchQuery = z.object({ q: z.string().trim().min(1).max(100), page: z.coerce.number().int().min(1).max(50).default(1) }).strict();
const ImageQuery = z.object({ src: z.string().max(500) }).strict();

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const IMAGE_MAX_BYTES = 15 * 1024 * 1024;

const unavailable = () => new HttpError(503, "Service Unavailable", "Stock photo search isn't set up on this server.");
const unloadable = () => new HttpError(502, "Bad Gateway", "The photo couldn't be loaded.");

/**
 * Stock photos from Pexels. The API key stays on the server, and photo files are passed through this
 * site (only from Pexels' image host) so the page never loads third-party images.
 */
export function stockHandlers(deps: Deps, pexels: PexelsClient | null, fetchImpl: typeof fetch = fetch) {
  return {
    search: endpoint(deps, { auth: "user", rateLimit: { name: "stockSearch", rule: RATE_LIMITS.stockSearch, by: "user" } }, async ({ req }) => {
      if (!pexels) throw unavailable();
      const q = readQuery(req, SearchQuery);
      try {
        return Response.json(await pexels.search(q.q, q.page));
      } catch (err) {
        if (err instanceof PexelsError && err.status === 429) throw new HttpError(503, "Service Unavailable", "Photo search is busy right now. Try again in a few minutes.");
        deps.logger.error("stock.search_failed", { err });
        throw new HttpError(502, "Bad Gateway", "Photo search didn't answer. Try again.");
      }
    }),

    image: endpoint(deps, { auth: "user", rateLimit: { name: "stockImage", rule: RATE_LIMITS.stockImage, by: "user" } }, async ({ req }) => {
      if (!pexels) throw unavailable();
      const { src } = readQuery(req, ImageQuery);
      if (!isPexelsImage(src)) throw new HttpError(400, "Bad Request", "That isn't a Pexels photo.");
      let res: Response;
      try {
        res = await fetchImpl(src, { redirect: "error", signal: AbortSignal.timeout(15_000) });
      } catch {
        throw unloadable();
      }
      const type = res.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
      const length = Number(res.headers.get("content-length") ?? "0");
      if (!res.ok || !res.body || !IMAGE_TYPES.has(type) || length > IMAGE_MAX_BYTES) {
        await res.body?.cancel();
        throw unloadable();
      }
      return new Response(capped(res.body, IMAGE_MAX_BYTES), {
        headers: { "content-type": type, "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff" },
      });
    }),
  };
}

/** Passes a stream through, failing it if it grows past `max` bytes (a missing or false length header). */
function capped(body: ReadableStream<Uint8Array>, max: number): ReadableStream<Uint8Array> {
  let total = 0;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        total += chunk.byteLength;
        if (total > max) controller.error(new Error("photo too large"));
        else controller.enqueue(chunk);
      },
    }),
  );
}

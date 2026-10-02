import type { Deps } from "../deps";
import { readQuery } from "../http/body";
import { pageQuery } from "../http/cursor";
import { endpoint } from "../http/endpoint";
import { notFound } from "../http/problem";
import { RATE_LIMITS } from "../rate-limit/rules";
import { galleryPage } from "../templates/gallery";
import { getPublicProfile } from "./repository";

/** Same shape /api/me accepts; handles are stored lowercase. */
const HANDLE = /^[a-z0-9_]{3,30}$/;

export function userHandlers(deps: Deps) {
  return {
    get: endpoint(deps, { auth: "none", rateLimit: { name: "publicRead", rule: RATE_LIMITS.publicRead, by: "ip" } }, async ({ req, params }) => {
      const handle = (params.handle ?? "").toLowerCase();
      if (!HANDLE.test(handle)) throw notFound();
      const q = readQuery(req, pageQuery);
      const p = await getPublicProfile(deps.db, handle);
      if (!p) throw notFound();
      const page = await galleryPage(deps.db, { authorId: p.id, sort: "new", cursor: q.cursor, limit: q.limit });
      return Response.json({
        profile: { handle: p.handle, name: p.name, image: p.image, joinedAt: p.createdAt.toISOString(), templates: p.templates, uses: p.uses },
        templates: page,
      });
    }),
  };
}

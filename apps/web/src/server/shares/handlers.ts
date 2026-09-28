import type { Deps } from "../deps";
import { toDesignJson } from "../designs/handlers";
import { getDesignVersion } from "../designs/repository";
import { endpoint } from "../http/endpoint";
import { parseId } from "../http/ids";
import { notFound } from "../http/problem";
import { RATE_LIMITS } from "../rate-limit/rules";
import type { ObjectStorage } from "../storage/types";
import { remixShare } from "./remix";
import { listActiveShareLinks, revokeShareLink } from "./repository";
import { createShare, viewShare } from "./service";

const writeLimit = { name: "userWrite", rule: RATE_LIMITS.userWrite, by: "user" } as const;

export function shareHandlers(deps: Deps, storage: ObjectStorage | null) {
  const ctx = { db: deps.db, now: deps.now };
  return {
    create: endpoint(deps, { auth: "user", rateLimit: { name: "shareCreate", rule: RATE_LIMITS.shareCreate, by: "user" } }, async ({ user, params }) => {
      const { link, token } = await createShare(ctx, user.id, parseId(params.id));
      return Response.json({ id: link.id, token, url: `${deps.config.appOrigin}/s/${token}`, createdAt: link.createdAt.toISOString() }, { status: 201 });
    }),

    list: endpoint(deps, { auth: "user" }, async ({ user, params }) => {
      const designId = parseId(params.id);
      if ((await getDesignVersion(deps.db, user.id, designId)) === undefined) throw notFound();
      const links = await listActiveShareLinks(deps.db, designId);
      return Response.json({ items: links.map((l) => ({ id: l.id, createdAt: l.createdAt.toISOString() })) });
    }),

    revoke: endpoint(deps, { auth: "user", rateLimit: writeLimit }, async ({ user, params }) => {
      if (!(await revokeShareLink(deps.db, user.id, parseId(params.id), parseId(params.linkId), deps.now()))) throw notFound();
      return new Response(null, { status: 204 });
    }),

    view: endpoint(deps, { auth: "none", rateLimit: { name: "sharedView", rule: RATE_LIMITS.sharedView, by: "ip" } }, async ({ params }) => {
      return Response.json(await viewShare({ ...ctx, storage }, params.token ?? ""));
    }),

    remix: endpoint(deps, { auth: "user", rateLimit: { name: "designCreate", rule: RATE_LIMITS.designCreate, by: "user" } }, async ({ user, params }) => {
      const design = await remixShare({ ...ctx, storage }, user, params.token ?? "");
      return Response.json(toDesignJson(design), { status: 201 });
    }),
  };
}

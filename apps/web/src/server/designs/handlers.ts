import { LIMITS } from "@vash/schema";
import { z } from "zod";
import type { Deps } from "../deps";
import { readJson, readQuery } from "../http/body";
import { decodeCursor, pageQuery, toPage } from "../http/cursor";
import { endpoint } from "../http/endpoint";
import { parseId } from "../http/ids";
import { notFound } from "../http/problem";
import { RATE_LIMITS } from "../rate-limit/rules";
import * as repo from "./repository";
import * as service from "./service";

const Title = z.string().trim().min(1).max(LIMITS.titleChars);
const FolderId = z.uuid().nullable();
const DOC_BODY_LIMIT = LIMITS.docBytes + 16 * 1024;

const CreateBody = z.object({ id: z.uuid().transform((s) => s.toLowerCase()).optional(), title: Title.optional(), folderId: FolderId.optional(), doc: z.unknown() }).strict();
const SaveBody = z.object({ doc: z.unknown(), version: z.number().int().positive() }).strict();
const PatchBody = z
  .object({ title: Title.optional(), folderId: FolderId.optional() })
  .strict()
  .refine((b) => b.title !== undefined || b.folderId !== undefined, "Provide title or folderId.");
const ListQuery = pageQuery.extend({ folderId: z.uuid().optional() });
const createLimit = { name: "designCreate", rule: RATE_LIMITS.designCreate, by: "user" } as const;
const writeLimit = { name: "userWrite", rule: RATE_LIMITS.userWrite, by: "user" } as const;

const summary = (d: Omit<repo.DesignSummary, "format" | "width" | "height">) => ({
  id: d.id,
  title: d.title,
  folderId: d.folderId,
  thumbnailAssetId: d.thumbnailAssetId,
  version: d.version,
  createdAt: d.createdAt.toISOString(),
  updatedAt: d.updatedAt.toISOString(),
});
const listItem = (d: repo.DesignSummary) => ({ ...summary(d), format: d.format, width: d.width, height: d.height });
export const toDesignJson = (d: repo.DesignRow) => ({ ...summary(d), doc: d.doc, sourceTemplateId: d.sourceTemplateId, sourceTemplateVersion: d.sourceTemplateVersion });

const prefersMinimal = (req: Request) => /(^|[,;\s])return=minimal($|[,;\s])/i.test(req.headers.get("prefer") ?? "");

export function designHandlers(deps: Deps) {
  const ctx = { db: deps.db, now: deps.now };
  return {
    list: endpoint(deps, { auth: "user" }, async ({ req, user }) => {
      const q = readQuery(req, ListQuery);
      const rows = await repo.listDesigns(deps.db, user.id, { folderId: q.folderId, cursor: q.cursor ? decodeCursor(q.cursor) : undefined, limit: q.limit });
      return Response.json(toPage(rows, q.limit, (r) => ({ at: r.updatedAt.toISOString(), id: r.id }), listItem));
    }),

    create: endpoint(deps, { auth: "user", rateLimit: createLimit }, async ({ req, user }) => {
      const body = await readJson(req, CreateBody, DOC_BODY_LIMIT);
      const { design, created } = await service.createDesign(ctx, user.id, body);
      return Response.json(toDesignJson(design), { status: created ? 201 : 200 });
    }),

    get: endpoint(deps, { auth: "user" }, async ({ user, params }) => {
      const row = await repo.getDesign(deps.db, user.id, parseId(params.id));
      if (!row) throw notFound();
      return Response.json(toDesignJson(row));
    }),

    save: endpoint(deps, { auth: "user", rateLimit: { name: "designSave", rule: RATE_LIMITS.designSave, by: "user" } }, async ({ req, user, params }) => {
      const id = parseId(params.id);
      const body = await readJson(req, SaveBody, DOC_BODY_LIMIT);
      const saved = await service.saveDesignDoc(ctx, user.id, id, body);
      // RFC 7240: autosave only needs the new version, so it asks not to get the whole document back.
      if (prefersMinimal(req)) return Response.json(summary(saved), { headers: { "preference-applied": "return=minimal" } });
      return Response.json(toDesignJson(saved));
    }),

    patch: endpoint(deps, { auth: "user", rateLimit: writeLimit }, async ({ req, user, params }) => {
      const id = parseId(params.id);
      const body = await readJson(req, PatchBody);
      if (prefersMinimal(req)) {
        const row = await service.updateDesignMeta(ctx, user.id, id, body, { withDoc: false });
        return Response.json(summary(row), { headers: { "preference-applied": "return=minimal" } });
      }
      return Response.json(toDesignJson((await service.updateDesignMeta(ctx, user.id, id, body)) as repo.DesignRow));
    }),

    remove: endpoint(deps, { auth: "user", rateLimit: writeLimit }, async ({ user, params }) => {
      if (!(await repo.deleteDesign(deps.db, user.id, parseId(params.id)))) throw notFound();
      return new Response(null, { status: 204 });
    }),

    duplicate: endpoint(deps, { auth: "user", rateLimit: createLimit }, async ({ user, params }) => {
      return Response.json(toDesignJson(await service.duplicateDesign(ctx, user.id, parseId(params.id))), { status: 201 });
    }),
  };
}

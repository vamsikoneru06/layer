import { CATEGORIES, FORMAT_KEYS } from "@vash/schema";
import { z } from "zod";
import type { Deps } from "../deps";
import { toDesignJson } from "../designs/handlers";
import { readJson, readQuery } from "../http/body";
import { pageQuery } from "../http/cursor";
import { endpoint } from "../http/endpoint";
import { parseId } from "../http/ids";
import { notFound } from "../http/problem";
import { RATE_LIMITS } from "../rate-limit/rules";
import { analyzeDraft, PUBLISH_LIMITS } from "./draft";
import { galleryPage } from "./gallery";
import * as repo from "./repository";
import { useTemplate } from "./use";
import { canSee, toTemplateJson } from "./view";

const publicRead = { name: "publicRead", rule: RATE_LIMITS.publicRead, by: "ip" } as const;
const createLimit = { name: "designCreate", rule: RATE_LIMITS.designCreate, by: "user" } as const;
const writeLimit = { name: "userWrite", rule: RATE_LIMITS.userWrite, by: "user" } as const;
const Uuid = z.uuid().transform((s) => s.toLowerCase());
const PreflightBody = z.object({ designId: Uuid, keep: z.array(Uuid).max(PUBLISH_LIMITS.keptPhotos).default([]) }).strict();

const GalleryParams = pageQuery.extend({
  q: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((v) => v || undefined),
  category: z.string().refine((c) => CATEGORIES.includes(c), "Unknown category.").optional(),
  format: z.string().refine((f) => (FORMAT_KEYS as readonly string[]).includes(f), "Unknown format.").optional(),
  sort: z.enum(["popular", "new", "featured"]).default("popular"),
});

export function templateHandlers(deps: Deps) {
  return {
    list: endpoint(deps, { auth: "none", rateLimit: publicRead }, async ({ req }) => {
      return Response.json(await galleryPage(deps.db, readQuery(req, GalleryParams)));
    }),

    get: endpoint(deps, { auth: "optional", rateLimit: publicRead }, async ({ user, params }) => {
      const card = await repo.getTemplateCard(deps.db, parseId(params.id));
      if (!card || !canSee(card, user)) throw notFound();
      const version = await repo.getTemplateVersion(deps.db, card.id, card.currentVersion);
      if (!version) throw notFound();
      return Response.json({ ...toTemplateJson(card), doc: version.doc });
    }),

    use: endpoint(deps, { auth: "user", rateLimit: createLimit }, async ({ user, params }) => {
      const design = await useTemplate({ db: deps.db, now: deps.now }, user, parseId(params.id));
      return Response.json(toDesignJson(design), { status: 201 });
    }),

    preflight: endpoint(deps, { auth: "user", rateLimit: writeLimit }, async ({ req, user }) => {
      const body = await readJson(req, PreflightBody);
      const draft = await analyzeDraft(deps.db, user.id, body.designId, body.keep);
      return Response.json({ ok: draft.issues.length === 0, issues: draft.issues, pii: draft.pii, photos: draft.photos });
    }),
  };
}

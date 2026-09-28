import { CATEGORIES, FORMAT_KEYS, LIMITS } from "@vash/schema";
import { z } from "zod";
import type { Deps } from "../deps";
import { toDesignJson } from "../designs/handlers";
import { readJson, readQuery } from "../http/body";
import { pageQuery } from "../http/cursor";
import { endpoint } from "../http/endpoint";
import { parseId } from "../http/ids";
import { HttpError, notFound } from "../http/problem";
import { RATE_LIMITS } from "../rate-limit/rules";
import type { ObjectStorage } from "../storage/types";
import { analyzeDraft, PUBLISH_LIMITS } from "./draft";
import { galleryPage } from "./gallery";
import { publishTemplate, type PublishContext } from "./publish";
import * as repo from "./repository";
import { useTemplate } from "./use";
import { canSee, toTemplateJson } from "./view";

const publicRead = { name: "publicRead", rule: RATE_LIMITS.publicRead, by: "ip" } as const;
const createLimit = { name: "designCreate", rule: RATE_LIMITS.designCreate, by: "user" } as const;
const writeLimit = { name: "userWrite", rule: RATE_LIMITS.userWrite, by: "user" } as const;
const Uuid = z.uuid().transform((s) => s.toLowerCase());
const PreflightBody = z.object({ designId: Uuid, keep: z.array(Uuid).max(PUBLISH_LIMITS.keptPhotos).default([]) }).strict();
const publishLimit = { name: "publish", rule: RATE_LIMITS.publish, by: "user" } as const;
const PublishBody = z
  .object({
    designId: Uuid,
    title: z.string().trim().min(1).max(LIMITS.titleChars),
    description: z.string().trim().max(PUBLISH_LIMITS.descriptionChars).default(""),
    category: z.string().refine((c) => CATEGORIES.includes(c), "Unknown category."),
    tags: z
      .array(z.string().trim().toLowerCase().min(1).max(LIMITS.tagChars))
      .max(LIMITS.tags)
      .default([])
      .transform((tags) => [...new Set(tags)]),
    keep: z.array(Uuid).max(PUBLISH_LIMITS.keptPhotos).default([]),
    ownsKeptPhotos: z.boolean().default(false),
    thumbnailAssetId: Uuid,
  })
  .strict();

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

export function templateHandlers(deps: Deps, storage: ObjectStorage | null = null) {
  const publishing = (): PublishContext => {
    if (!storage) throw new HttpError(503, "Service Unavailable", "Photo storage isn't configured on this server.");
    return { db: deps.db, now: deps.now, storage };
  };
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

    publish: endpoint(deps, { auth: "user", rateLimit: publishLimit }, async ({ req, user }) => {
      const ctx = publishing();
      const r = await publishTemplate(ctx, user, await readJson(req, PublishBody), null);
      return Response.json({ template: toTemplateJson(r.template), warnings: { pii: r.pii } }, { status: 201 });
    }),

    publishVersion: endpoint(deps, { auth: "user", rateLimit: publishLimit }, async ({ req, user, params }) => {
      const ctx = publishing();
      const id = parseId(params.id);
      const r = await publishTemplate(ctx, user, await readJson(req, PublishBody), id);
      return Response.json({ template: toTemplateJson(r.template), warnings: { pii: r.pii } }, { status: 201 });
    }),
  };
}

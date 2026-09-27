import { CATEGORIES, FORMAT_KEYS } from "@vash/schema";
import { z } from "zod";
import type { Deps } from "../deps";
import { readQuery } from "../http/body";
import { pageQuery } from "../http/cursor";
import { endpoint } from "../http/endpoint";
import { parseId } from "../http/ids";
import { notFound } from "../http/problem";
import { RATE_LIMITS } from "../rate-limit/rules";
import { galleryPage } from "./gallery";
import * as repo from "./repository";
import { canSee, toTemplateJson } from "./view";

const publicRead = { name: "publicRead", rule: RATE_LIMITS.publicRead, by: "ip" } as const;

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
  };
}

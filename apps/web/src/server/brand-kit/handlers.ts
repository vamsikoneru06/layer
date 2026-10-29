import { FONT_FAMILIES } from "@vash/schema";
import { z } from "zod";
import type { Deps } from "../deps";
import { readJson } from "../http/body";
import { endpoint } from "../http/endpoint";
import { RATE_LIMITS } from "../rate-limit/rules";
import { BRAND_KIT_LIMITS, getBrandKit, saveBrandKit } from "./service";

const readLimit = { name: "userRead", rule: RATE_LIMITS.userRead, by: "user" } as const;
const writeLimit = { name: "userWrite", rule: RATE_LIMITS.userWrite, by: "user" } as const;

const KitBody = z
  .object({
    // #RRGGBB, stored upper-case, each colour once (in the order given).
    colors: z
      .array(z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use #RRGGBB colours."))
      .max(BRAND_KIT_LIMITS.colors)
      .transform((cs) => [...new Set(cs.map((c) => c.toUpperCase()))]),
    fonts: z
      .array(z.string().refine((f) => FONT_FAMILIES.includes(f), "Pick fonts from the font list."))
      .max(BRAND_KIT_LIMITS.fonts)
      .refine((fs) => new Set(fs).size === fs.length, "List each font once."),
    logoAssetId: z
      .uuid()
      .transform((id) => id.toLowerCase())
      .nullable(),
  })
  .strict();

/** `GET` and `PUT /api/me/brand-kit`: the signed-in user's saved colours, fonts and logo (roadmap M4). */
export function brandKitHandlers(deps: Deps) {
  return {
    get: endpoint(deps, { auth: "user", rateLimit: readLimit }, async ({ user }) => Response.json(await getBrandKit(deps.db, user.id))),
    put: endpoint(deps, { auth: "user", rateLimit: writeLimit }, async ({ req, user }) =>
      Response.json(await saveBrandKit(deps.db, user.id, await readJson(req, KitBody), deps.now())),
    ),
  };
}

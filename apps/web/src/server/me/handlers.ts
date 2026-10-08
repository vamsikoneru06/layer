import { CATEGORIES, LIMITS } from "@vash/schema";
import { z } from "zod";
import { expiredSessionCookies } from "../auth/cookies";
import { twoFactorStatus } from "../auth/two-factor";
import type { Deps } from "../deps";
import { readJson } from "../http/body";
import { endpoint } from "../http/endpoint";
import { unprocessable } from "../http/problem";
import { RATE_LIMITS } from "../rate-limit/rules";
import { deleteAccount, exportAccount, getProfile, toProfile, updateProfile } from "./service";

const RESERVED_HANDLES = new Set([
  "admin", "administrator", "api", "app", "auth", "author", "designs", "edit", "help", "home", "layer", "vash", "media", "me",
  "moderation", "onboarding", "publish", "root", "s", "settings", "signin", "signup", "support", "system", "templates", "u",
]);

const writeLimit = { name: "userWrite", rule: RATE_LIMITS.userWrite, by: "user" } as const;
const readLimit = { name: "userRead", rule: RATE_LIMITS.userRead, by: "user" } as const;

const PatchMe = z
  .object({
    name: z.string().trim().min(1).max(LIMITS.nameChars).optional(),
    handle: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9_]{3,30}$/, "Use 3–30 characters: a–z, 0–9 and _.")
      .refine((h) => !RESERVED_HANDLES.has(h), "This handle is reserved.")
      .optional(),
    interests: z.array(z.string().refine((c) => CATEGORIES.includes(c), "Unknown category.")).max(10).optional(),
    completeOnboarding: z.literal(true).optional(),
  })
  .strict();

/** Deleting an account can't be undone, so the request must name the account it deletes. */
const DeleteMe = z.object({ confirm: z.string().trim().max(320) }).strict();

export function meHandlers(deps: Deps) {
  return {
    get: endpoint(deps, { auth: "user", rateLimit: readLimit }, async ({ user }) =>
      Response.json({ ...toProfile(await getProfile(deps.db, user.id)), twoFactor: twoFactorStatus(user, deps.now()) }),
    ),

    patch: endpoint(deps, { auth: "user", rateLimit: writeLimit }, async ({ req, user }) => {
      const patch = await readJson(req, PatchMe);
      return Response.json({ ...toProfile(await updateProfile(deps.db, user.id, patch, deps.now())), twoFactor: twoFactorStatus(user, deps.now()) });
    }),

    remove: endpoint(deps, { auth: "user", rateLimit: writeLimit }, async ({ req, user }) => {
      const { confirm } = await readJson(req, DeleteMe, 1024);
      if (confirm.toLowerCase() !== user.email.toLowerCase()) {
        throw unprocessable("Type your account email to confirm deleting your account.");
      }
      await deleteAccount(deps.db, user.id, deps.now());
      const headers = new Headers();
      for (const cookie of expiredSessionCookies(deps.config)) headers.append("set-cookie", cookie);
      return new Response(null, { status: 204, headers });
    }),

    export: endpoint(deps, { auth: "user", rateLimit: { name: "accountExport", rule: RATE_LIMITS.accountExport, by: "user" } }, async ({ user }) => {
      const chunks = exportAccount(deps.db, user.id, deps.now());
      const head = await chunks.next();
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          if (!head.done) controller.enqueue(encoder.encode(head.value));
        },
        async pull(controller) {
          try {
            const next = await chunks.next();
            if (next.done) controller.close();
            else controller.enqueue(encoder.encode(next.value));
          } catch (err) {
            deps.logger.error("export.failed", { userId: user.id, err });
            controller.error(err);
          }
        },
        async cancel() {
          await chunks.return(undefined);
        },
      });
      return new Response(body, {
        headers: { "content-type": "application/json", "content-disposition": 'attachment; filename="vash-export.json"' },
      });
    }),
  };
}

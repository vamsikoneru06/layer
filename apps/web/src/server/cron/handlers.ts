import { createHash, timingSafeEqual } from "node:crypto";
import type { Deps } from "../deps";
import { endpoint } from "../http/endpoint";
import { HttpError } from "../http/problem";
import type { ObjectStorage } from "../storage/types";
import { runCleanup } from "./cleanup";

/** Constant-time comparison of `Authorization: Bearer <secret>` (hashing equalises lengths). */
function bearerMatches(header: string | null, secret: string): boolean {
  const presented = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  return timingSafeEqual(createHash("sha256").update(presented).digest(), createHash("sha256").update(secret).digest());
}

/** Wraps a run, e.g. with Sentry cron check-ins so a failed or missed run raises an alert. */
export type CronMonitor = <T>(job: () => Promise<T>) => Promise<T>;

export function cronHandlers(deps: Deps, storage: ObjectStorage | null, cronSecret: string | null, monitor: CronMonitor = (job) => job()) {
  return {
    cleanup: endpoint(deps, { auth: "none" }, async ({ req }) => {
      if (!cronSecret || !bearerMatches(req.headers.get("authorization"), cronSecret)) {
        throw new HttpError(401, "Unauthorized", "A valid cron token is required.");
      }
      const result = await monitor(() => runCleanup(deps.db, storage, deps.now()));
      deps.logger.info("cron.cleanup", result);
      return Response.json(result);
    }),
  };
}

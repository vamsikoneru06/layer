import { sql } from "drizzle-orm";
import type { Deps } from "../deps";
import { endpoint } from "../http/endpoint";

/** Public and unauthenticated, so the probe result is reused briefly: a flood costs one query per window. */
const PROBE_TTL_MS = 5_000;

export function healthHandlers(deps: Deps) {
  let last: { at: number; ok: boolean } | undefined;

  async function probe(): Promise<boolean> {
    const at = deps.now().getTime();
    if (last && at - last.at < PROBE_TTL_MS) return last.ok;
    let ok = true;
    try {
      await deps.db.execute(sql`select 1`);
    } catch (err) {
      deps.logger.error("health.db_unreachable", { err });
      ok = false;
    }
    last = { at, ok };
    return ok;
  }

  return {
    get: endpoint(deps, { auth: "none" }, async () =>
      (await probe()) ? Response.json({ status: "ok" }) : Response.json({ status: "unavailable" }, { status: 503 }),
    ),
  };
}

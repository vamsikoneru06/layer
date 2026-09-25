import { sql } from "drizzle-orm";
import type { Deps } from "../deps";
import { endpoint } from "../http/endpoint";

export function healthHandlers(deps: Deps) {
  return {
    get: endpoint(deps, { auth: "none" }, async () => {
      try {
        await deps.db.execute(sql`select 1`);
      } catch (err) {
        deps.logger.error("health.db_unreachable", { err });
        return Response.json({ status: "unavailable" }, { status: 503 });
      }
      return Response.json({ status: "ok" });
    }),
  };
}

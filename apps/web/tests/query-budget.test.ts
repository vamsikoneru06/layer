import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { createEmptyDoc } from "@vash/schema";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assetHandlers } from "@/server/assets/handlers";
import { createAuth, createAuthRoute } from "@/server/auth/auth";
import { createAuthenticator } from "@/server/auth/current-user";
import * as schema from "@/server/db/schema";
import type { Db } from "@/server/db/types";
import type { Deps } from "@/server/deps";
import { designHandlers } from "@/server/designs/handlers";
import type { Handler } from "@/server/http/types";
import { silentLogger } from "@/server/logging";
import { meHandlers } from "@/server/me/handlers";
import { templateHandlers } from "@/server/templates/handlers";
import { testConfig } from "./support/config";
import { createTemplate } from "./support/factories";
import { captureMailer } from "./support/mailer";
import { memoryStorage } from "./support/storage";

/**
 * Database round trips per request, signed in with a real Better Auth session. In production each one is a
 * network round trip to Neon, so these are budgets: a change that adds a query to a hot path fails here.
 * Signed-in requests start with one query for the session and user; rate-limited ones (every signed-in read since
 * #47) add one write.
 */
let client: PGlite;
let db: Db;
let queries = 0;
let cookie = "";
let deps: Deps;
const origin = testConfig.appOrigin;

beforeAll(async () => {
  client = new PGlite();
  db = drizzle(client, { schema, logger: { logQuery: () => void queries++ } }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });
  const mailer = captureMailer();
  const auth = createAuth({ db, config: testConfig, mailer, now: () => new Date() });
  const route = createAuthRoute(auth, { db, config: testConfig, now: () => new Date() });
  await route.POST(
    new Request(`${origin}/api/auth/sign-in/magic-link`, {
      method: "POST",
      headers: { "content-type": "application/json", origin, "x-forwarded-for": "198.51.100.9" },
      body: JSON.stringify({ email: "budget@example.test", callbackURL: "/home" }),
    }),
  );
  const link = /https?:\/\/\S+/.exec(mailer.sent.at(-1)!.text)![0];
  const res = await route.GET(new Request(link, { headers: { "x-forwarded-for": "198.51.100.9" } }));
  cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  deps = { db, config: testConfig, logger: silentLogger, now: () => new Date(), authenticate: createAuthenticator(auth, db) };
}, 60_000);
afterAll(() => client.close());

async function measure(handler: Handler, path: string, init: RequestInit & { json?: unknown } = {}, params: Record<string, string> = {}) {
  const { json, headers, ...rest } = init;
  const req = new Request(`${origin}${path}`, {
    ...rest,
    headers: { cookie, origin, "x-forwarded-for": "198.51.100.9", ...(json === undefined ? {} : { "content-type": "application/json" }), ...(headers as Record<string, string>) },
    ...(json === undefined ? {} : { body: JSON.stringify(json) }),
  });
  queries = 0;
  const res = await handler(req, { params: Promise.resolve(params) });
  return { status: res.status, queries };
}

describe("database round trips per request", () => {
  it("stays within budget on the hot paths", async () => {
    const designs = designHandlers(deps);
    const me = meHandlers(deps);
    const templates = templateHandlers(deps, memoryStorage());
    const assets = assetHandlers(deps, memoryStorage());

    const id = "00000000-0000-4000-8000-000000000001";
    const doc = createEmptyDoc({ id, kind: "design", title: "Budget", format: "ig-post" });
    expect((await measure(designs.create, "/api/designs", { method: "POST", json: { id, doc } })).status).toBe(201);
    const template = await createTemplate(db, { status: "published" });

    const budgets: [string, () => ReturnType<typeof measure>, number][] = [
      ["GET /api/me", () => measure(me.get, "/api/me"), 3],
      ["GET /api/designs", () => measure(designs.list, "/api/designs"), 3],
      ["GET /api/designs/:id", () => measure(designs.get, `/api/designs/${id}`, {}, { id }), 3],
      // Session, rate limit, then the compare-and-swap update alone.
      ["PUT /api/designs/:id", () => measure(designs.save, `/api/designs/${id}`, { method: "PUT", json: { doc, version: 1 }, headers: { prefer: "return=minimal" } }, { id }), 3],
      ["GET /api/templates", () => measure(templates.list, "/api/templates"), 2],
      ["GET /api/templates/:id", () => measure(templates.get, `/api/templates/${template.id}`, {}, { id: template.id }), 3],
      ["POST /api/assets/resolve", () => measure(assets.resolve, "/api/assets/resolve", { method: "POST", json: { ids: ["00000000-0000-4000-8000-0000000000aa"] } }), 3],
    ];
    // One at a time: every measurement resets the shared counter.
    for (const [name, run, budget] of budgets) {
      const { status, queries: used } = await run();
      expect(status, name).toBeLessThan(300);
      expect(used, name).toBeLessThanOrEqual(budget);
    }
  });
});

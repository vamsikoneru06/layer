import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../../tests/support/db";
import { testConfig } from "../../../tests/support/config";
import { testDeps } from "../../../tests/support/deps";
import { call } from "../../../tests/support/invoke";
import { RATE_LIMITS } from "../rate-limit/rules";
import { monitoringHandlers, TUNNEL_BODY_LIMIT } from "./handlers";

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(() => t.close());

const DSN = "https://pubkey@o45.ingest.de.sentry.io/678";
const envelope = (dsn: string) => `${JSON.stringify({ event_id: "e1", dsn, sent_at: "2026-10-04T00:00:00Z" })}\n{"type":"event"}\n{"message":"x"}`;

function setup(opts: { dsn?: string | null; upstream?: () => Promise<Response> } = {}) {
  const forwarded: { url: string; body: string; headers: Headers }[] = [];
  const forward = (async (url: string | URL | Request, init?: RequestInit) => {
    forwarded.push({ url: String(url), body: String(init?.body), headers: new Headers(init?.headers) });
    return opts.upstream ? opts.upstream() : new Response("{}", { status: 200 });
  }) as typeof fetch;
  const deps = testDeps(t.db, { config: { ...testConfig, sentryDsn: opts.dsn === undefined ? DSN : opts.dsn } });
  return { tunnel: monitoringHandlers(deps, forward).tunnel, forwarded };
}

let ipCounter = 0;
const post = (rawBody: string, extra: { origin?: string | null; ip?: string } = {}) => ({
  method: "POST",
  rawBody,
  headers: { "content-type": "text/plain;charset=UTF-8" },
  ip: extra.ip ?? `198.51.100.${++ipCounter}`,
  ...(extra.origin !== undefined ? { origin: extra.origin } : {}),
});

describe("POST /api/monitoring", () => {
  it("relays our envelopes to our Sentry project unchanged", async () => {
    const { tunnel, forwarded } = setup();
    const body = envelope(DSN);
    expect((await call(tunnel, post(body))).status).toBe(200);
    expect(forwarded).toHaveLength(1);
    expect(forwarded[0]!.url).toBe("https://o45.ingest.de.sentry.io/api/678/envelope/");
    expect(forwarded[0]!.body).toBe(body);
    expect(forwarded[0]!.headers.get("content-type")).toBe("application/x-sentry-envelope");
  });

  it("is not there when Sentry isn't configured, and doesn't touch the database to say so", async () => {
    const untouchable = new Proxy({}, { get: () => () => Promise.reject(new Error("database used")) }) as typeof t.db;
    const off = monitoringHandlers(testDeps(untouchable, { config: { ...testConfig, sentryDsn: null } })).tunnel;
    expect((await call(off, post(envelope(DSN)))).status).toBe(404);
    const { tunnel, forwarded } = setup({ dsn: null });
    expect((await call(tunnel, post(envelope(DSN)))).status).toBe(404);
    expect(forwarded).toHaveLength(0);
  });

  it("refuses envelopes for any other DSN, so it can't relay to someone else's project", async () => {
    const { tunnel, forwarded } = setup();
    for (const other of ["https://pubkey@o45.ingest.de.sentry.io/999", "https://pubkey@evil.example/678", "https://other@o45.ingest.de.sentry.io/678"]) {
      expect((await call(tunnel, post(envelope(other)))).status).toBe(400);
    }
    expect((await call(tunnel, post("not json\n{}"))).status).toBe(400);
    expect((await call(tunnel, post(`${JSON.stringify({ event_id: "e1" })}\n{}`))).status).toBe(400);
    expect(forwarded).toHaveLength(0);
  });

  it("rejects bodies over the limit and cross-origin posts", async () => {
    const { tunnel, forwarded } = setup();
    expect((await call(tunnel, post(envelope(DSN) + "x".repeat(TUNNEL_BODY_LIMIT)))).status).toBe(413);
    expect((await call(tunnel, post(envelope(DSN), { origin: "https://evil.example" }))).status).toBe(403);
    expect(forwarded).toHaveLength(0);
  });

  it("rate-limits each IP address", async () => {
    const { tunnel } = setup();
    const ip = "192.0.2.77";
    for (let i = 0; i < RATE_LIMITS.errorReport.max; i++) expect((await call(tunnel, post(envelope(DSN), { ip }))).status).toBe(200);
    expect((await call(tunnel, post(envelope(DSN), { ip }))).status).toBe(429);
  });

  it("still relays when the rate-limit store is down, since that's when reports matter most", async () => {
    const forwarded: string[] = [];
    const forward = (async (url: string | URL | Request) => (forwarded.push(String(url)), new Response("{}"))) as typeof fetch;
    const down = {
      insert: () => {
        throw new Error("database down");
      },
    } as unknown as typeof t.db;
    const tunnel = monitoringHandlers(testDeps(down, { config: { ...testConfig, sentryDsn: DSN } }), forward).tunnel;
    expect((await call(tunnel, post(envelope(DSN)))).status).toBe(200);
    expect(forwarded).toHaveLength(1);
  });

  it("passes Sentry's own rate limiting back to the browser SDK", async () => {
    const { tunnel } = setup({
      upstream: async () => new Response("", { status: 429, headers: { "x-sentry-rate-limits": "60:error:organization", "retry-after": "60" } }),
    });
    const res = await call(tunnel, post(envelope(DSN)));
    expect(res.status).toBe(429);
    expect(res.headers.get("x-sentry-rate-limits")).toBe("60:error:organization");
    expect(res.headers.get("retry-after")).toBe("60");
  });

  it("answers 502 when Sentry can't be reached", async () => {
    const { tunnel } = setup({ upstream: () => Promise.reject(new Error("ECONNRESET")) });
    expect((await call(tunnel, post(envelope(DSN)))).status).toBe(502);
  });
});

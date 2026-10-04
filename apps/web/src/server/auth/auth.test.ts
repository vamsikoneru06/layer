import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testConfig } from "../../../tests/support/config";
import { createTestDb, type TestDb } from "../../../tests/support/db";
import { captureMailer } from "../../../tests/support/mailer";
import { user, verification } from "../db/schema";
import { createAuth, createAuthRoute, type Auth } from "./auth";
import { createAuthenticator } from "./current-user";

let t: TestDb;
let auth: Auth;
let route: ReturnType<typeof createAuthRoute>;
const mailer = captureMailer();

beforeAll(async () => {
  t = await createTestDb();
  auth = createAuth({ db: t.db, config: testConfig, mailer, now: () => new Date() });
  route = createAuthRoute(auth, testConfig);
});
afterAll(() => t.close());

const origin = testConfig.appOrigin;

function requestLink(body: Record<string, unknown>, ip = "198.51.100.1", requestOrigin: string = origin) {
  return route.POST(
    new Request(`${origin}/api/auth/sign-in/magic-link`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: requestOrigin, "x-forwarded-for": ip },
      body: JSON.stringify({ callbackURL: "/home", ...body }),
    }),
  );
}

function linkSentTo(email: string): URL {
  const message = mailer.sent.findLast((m) => m.to === email);
  const url = message && /https?:\/\/\S+/.exec(message.text)?.[0];
  if (!url) throw new Error(`no link sent to ${email}`);
  return new URL(url);
}

function sessionCookie(res: Response): string | null {
  for (const header of res.headers.getSetCookie()) {
    const pair = header.split(";")[0] ?? "";
    if (/session_token=./.test(pair)) return pair;
  }
  return null;
}

const verify = (link: URL) => route.GET(new Request(link, { headers: { "x-forwarded-for": "198.51.100.1" } }));

describe("magic-link sign-in", () => {
  it("signs a new user in with a single-use, hashed, 10-minute link", async () => {
    const email = "riya@example.test";
    expect((await requestLink({ email })).status).toBe(200);
    const link = linkSentTo(email);
    const token = link.searchParams.get("token");
    expect(token).toBeTruthy();

    const rows = await t.db.select().from(verification);
    expect(rows.some((r) => r.identifier.includes(token!) || r.value.includes(token!))).toBe(false);
    const ttl = Math.max(...rows.map((r) => r.expiresAt.getTime())) - Date.now();
    expect(ttl).toBeGreaterThan(9 * 60_000);
    expect(ttl).toBeLessThanOrEqual(10 * 60_000);

    const first = await verify(link);
    expect(first.status).toBe(302);
    const cookie = sessionCookie(first);
    expect(cookie).toBeTruthy();
    const setCookie = first.headers.getSetCookie().join("\n");
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);

    const current = await createAuthenticator(auth, t.db)(new Request(`${origin}/api/me`, { headers: { cookie: cookie! } }));
    expect(current).toMatchObject({ email, role: "user", handle: null });

    expect(sessionCookie(await verify(link))).toBeNull();
  });

  it("never lets a sign-up body set the role", async () => {
    const email = "sneaky@example.test";
    await requestLink({ email, name: "Sneaky", role: "admin" });
    await verify(linkSentTo(email));
    const [row] = await t.db.select().from(user).where(eq(user.email, email));
    expect(row?.role).toBe("user");
  });

  it("allows 5 links per hour per email", async () => {
    const statuses = [];
    for (let i = 0; i < 6; i++) statuses.push((await requestLink({ email: "flood@example.test" }, `198.51.100.${20 + i}`)).status);
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
  });

  it("allows 20 links per hour per IP", async () => {
    const statuses = [];
    for (let i = 0; i < 21; i++) statuses.push((await requestLink({ email: `ip${i}@example.test` }, "203.0.113.50")).status);
    expect(statuses.slice(0, 20).every((s) => s === 200)).toBe(true);
    expect(statuses[20]).toBe(429);
  });

  it("rejects sign-in requests from another origin", async () => {
    const res = await requestLink({ email: "x@example.test" }, "198.51.100.77", "https://evil.example");
    expect(res.status).toBe(403);
    expect(res.headers.get("content-type")).toBe("application/problem+json");
  });

  it("treats a request without a session as signed out", async () => {
    expect(await createAuthenticator(auth, t.db)(new Request(`${origin}/api/me`))).toBeNull();
  });
});

describe("redirect targets (open redirect)", () => {
  // The encoded ones matter: Better Auth decodes the redirect again when the link is clicked.
  const offsite = [
    "https://evil.example/phish",
    "//evil.example/phish",
    "https://vash.test.evil.example/",
    "/\\evil.example",
    "%2F%2Fevil.example%2Fphish",
    "/%2F%2Fevil.example",
    "javascript:alert(1)",
  ];

  it.each(["callbackURL", "newUserCallbackURL", "errorCallbackURL"])("refuses to email a link whose %s leaves the app", async (field) => {
    for (const [i, target] of offsite.entries()) {
      const email = `redirect-${field}-${i}@example.test`;
      const before = mailer.sent.length;
      const res = await requestLink({ email, [field]: target }, `198.51.100.${120 + i}`);
      expect(res.status, `${field}=${target}`).toBe(403);
      expect(mailer.sent.length).toBe(before);
    }
  });

  it.each(["https://evil.example/phish", "%2F%2Fevil.example"])("refuses a link whose callbackURL was changed to %s", async (target) => {
    const email = `tamper-${target.length}@example.test`;
    expect((await requestLink({ email }, "198.51.100.140")).status).toBe(200);
    const link = linkSentTo(email);
    link.searchParams.set("callbackURL", target);
    const res = await verify(link);
    expect(res.status).toBe(403);
    expect(res.headers.get("location")).toBeNull();
  });

  it("still accepts same-site targets", async () => {
    const res = await requestLink({ email: "same-site@example.test", newUserCallbackURL: `${origin}/onboarding`, errorCallbackURL: "/signin?x=1" }, "198.51.100.160");
    expect(res.status).toBe(200);
  });

  it("refuses an off-site callbackURL for Google sign-in", async () => {
    const res = await route.POST(
      new Request(`${origin}/api/auth/sign-in/social`, {
        method: "POST",
        headers: { "content-type": "application/json", origin, "x-forwarded-for": "198.51.100.150" },
        body: JSON.stringify({ provider: "google", callbackURL: "https://evil.example/phish" }),
      }),
    );
    expect([400, 403, 404]).toContain(res.status);
  });
});

describe("magic-link abuse controls", () => {
  const countVerifications = async () => (await t.db.select().from(verification)).length;

  it("rejects an over-limit email before storing a verification row", async () => {
    for (let i = 0; i < 5; i++) await requestLink({ email: "store@example.test" }, `192.0.2.${i + 1}`);
    const before = await countVerifications();
    expect((await requestLink({ email: "store@example.test" }, "192.0.2.99")).status).toBe(429);
    expect(await countVerifications()).toBe(before);
  });

  it("rejects over-long names and oversized bodies without storing anything", async () => {
    const before = await countVerifications();
    expect((await requestLink({ email: "long@example.test", name: "x".repeat(81) }, "192.0.2.150")).status).toBe(400);
    const huge = await route.POST(
      new Request(`${origin}/api/auth/sign-in/magic-link`, {
        method: "POST",
        headers: { "content-type": "application/json", origin, "x-forwarded-for": "192.0.2.151" },
        body: JSON.stringify({ email: "huge@example.test", name: "x".repeat(20_000) }),
      }),
    );
    expect(huge.status).toBe(413);
    expect(await countVerifications()).toBe(before);
  });

  it("still limits links per client when no proxy is trusted (shared bucket, fail closed)", async () => {
    const untrusted = createAuthRoute(
      createAuth({ db: t.db, config: { ...testConfig, trustProxy: false }, mailer, now: () => new Date() }),
      testConfig,
    );
    const statuses = [];
    for (let i = 0; i < 21; i++) {
      const res = await untrusted.POST(
        new Request(`${origin}/api/auth/sign-in/magic-link`, {
          method: "POST",
          headers: { "content-type": "application/json", origin, "x-forwarded-for": `198.18.0.${i + 1}` },
          body: JSON.stringify({ email: `nat${i}@example.test`, callbackURL: "/home" }),
        }),
      );
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 20).every((s) => s === 200)).toBe(true);
    expect(statuses[20]).toBe(429);
  });

  it.each(["/update-user", "/delete-user", "/change-email", "/sign-up/email", "/sign-in/email", "/request-password-reset", "/get-access-token"])(
    "does not expose %s, which would bypass VASH's own rules",
    async (path) => {
      const res = await route.POST(
        new Request(`${origin}/api/auth${path}`, {
          method: "POST",
          headers: { "content-type": "application/json", origin, "x-forwarded-for": "192.0.2.200" },
          body: JSON.stringify({ name: "x".repeat(500), image: "javascript:alert(1)", email: "a@b.test", password: "password123" }),
        }),
      );
      expect(res.status).toBe(404);
    },
  );
});

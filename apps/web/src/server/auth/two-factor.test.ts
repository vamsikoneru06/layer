import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testConfig } from "../../../tests/support/config";
import { createTestDb, type TestDb } from "../../../tests/support/db";
import { captureMailer } from "../../../tests/support/mailer";
import { session, twoFactor, user } from "../db/schema";
import { createAuth, createAuthRoute, type Auth } from "./auth";
import { createAuthenticator } from "./current-user";

let t: TestDb;
let auth: Auth;
let route: ReturnType<typeof createAuthRoute>;
const mailer = captureMailer();
const origin = testConfig.appOrigin;

beforeAll(async () => {
  t = await createTestDb();
  auth = createAuth({ db: t.db, config: testConfig, mailer, now: () => new Date() });
  route = createAuthRoute(auth, { db: t.db, config: testConfig, now: () => new Date() });
});
afterAll(() => t.close());

// Better Auth allows 3 two-factor requests per 10 s per IP; a fresh IP per request keeps that out of these tests.
let ipCounter = 0;
const nextIp = () => `198.51.100.${(ipCounter++ % 250) + 1}`;

function sessionCookie(res: Response): string | null {
  for (const header of res.headers.getSetCookie()) {
    const pair = header.split(";")[0] ?? "";
    if (/session_token=./.test(pair)) return pair;
  }
  return null;
}

async function signIn(email: string, role: "user" | "admin" = "admin"): Promise<string> {
  const headers = { "content-type": "application/json", origin, "x-forwarded-for": nextIp() };
  await route.POST(new Request(`${origin}/api/auth/sign-in/magic-link`, { method: "POST", headers, body: JSON.stringify({ email, callbackURL: "/home" }) }));
  const text = mailer.sent.findLast((m) => m.to === email)?.text ?? "";
  const link = /https?:\/\/\S+/.exec(text)?.[0];
  if (!link) throw new Error(`no link sent to ${email}`);
  const cookie = sessionCookie(await route.GET(new Request(link, { headers: { "x-forwarded-for": nextIp() } })));
  if (!cookie) throw new Error("sign-in set no session cookie");
  await t.db.update(user).set({ role }).where(eq(user.email, email));
  return cookie;
}

const post = (path: string, cookie: string | null, body: unknown = {}) =>
  route.POST(
    new Request(`${origin}/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin, "x-forwarded-for": nextIp(), ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    }),
  );

const me = (cookie: string) => createAuthenticator(auth, t.db)(new Request(`${origin}/api/me`, { headers: { cookie } }));

/** RFC 6238 code for the secret in an otpauth:// URI, as an authenticator app computes it. */
function totp(uri: string, at = Date.now()): string {
  const secret = new URL(uri).searchParams.get("secret")!;
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of secret.replace(/=+$/, "")) bits += alphabet.indexOf(ch.toUpperCase()).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
  const mac = createHmac("sha1", key).update(counter).digest();
  const offset = mac[mac.length - 1]! & 0xf;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

const sessionIdOf = async (cookie: string) => (await auth.api.getSession({ headers: new Headers({ cookie }) }))!.session.id;
const setVerifiedAt = async (cookie: string, at: Date | null) =>
  t.db.update(session).set({ twoFactorVerifiedAt: at }).where(eq(session.id, await sessionIdOf(cookie)));

/** Signs an admin in and sets up two-factor; returns the rotated session cookie and the otpauth URI. */
async function enrolledAdmin(email: string) {
  const first = await signIn(email);
  const enabled = await post("/two-factor/enable", first);
  const { totpURI } = (await enabled.json()) as { totpURI: string };
  const confirmed = await post("/two-factor/verify-totp", first, { code: totp(totpURI) });
  expect(confirmed.status).toBe(200);
  return { cookie: sessionCookie(confirmed)!, totpURI };
}

describe("two-step verification", () => {
  it("is only for signed-in administrators", async () => {
    expect((await post("/two-factor/enable", null)).status).toBe(401);
    const res = await post("/two-factor/enable", await signIn("plain@example.test", "user"));
    expect(res.status).toBe(403);
    expect(await t.db.select().from(twoFactor)).toEqual([]);
  });

  it("sets up with an authenticator code, then unlocks admin tools on the new session", async () => {
    const cookie = await signIn("owner@example.test");
    expect(await me(cookie)).toMatchObject({ role: "admin", twoFactor: { enabled: false, verifiedAt: null } });

    const enabled = await post("/two-factor/enable", cookie);
    expect(enabled.status).toBe(200);
    const { totpURI, backupCodes } = (await enabled.json()) as { totpURI: string; backupCodes: string[] };
    expect(totpURI).toMatch(/^otpauth:\/\/totp\/VASH:/);
    expect(backupCodes).toHaveLength(10);
    // Stored encrypted, never as the key the app shows.
    const [row] = await t.db.select().from(twoFactor);
    expect(row!.secret).not.toContain(new URL(totpURI).searchParams.get("secret")!);
    expect((await me(cookie))!.twoFactor.enabled).toBe(false);

    expect((await post("/two-factor/verify-totp", cookie, { code: totp(totpURI, Date.now() - 10 * 60_000) })).status).toBe(401);
    const confirmed = await post("/two-factor/verify-totp", cookie, { code: totp(totpURI) });
    expect(confirmed.status).toBe(200);
    // Turning two-factor on replaces the session; the new one has passed a code.
    const rotated = sessionCookie(confirmed)!;
    expect(rotated).not.toBe(cookie);
    expect(await me(cookie)).toBeNull();
    const current = await me(rotated);
    expect(current?.twoFactor.enabled).toBe(true);
    expect(Date.now() - current!.twoFactor.verifiedAt!.getTime()).toBeLessThan(60_000);
  });

  it("asks every new session for a code, and accepts a backup code once", async () => {
    const email = "second@example.test";
    const { cookie } = await enrolledAdmin(email);
    const { backupCodes } = (await (await post("/two-factor/generate-backup-codes", cookie)).json()) as { backupCodes: string[] };

    const laptop = await signIn(email);
    expect((await me(laptop))!.twoFactor).toEqual({ enabled: true, verifiedAt: null });
    expect((await post("/two-factor/verify-backup-code", laptop, { code: backupCodes[0] })).status).toBe(200);
    expect((await me(laptop))!.twoFactor.verifiedAt).not.toBeNull();
    const phone = await signIn(email);
    expect((await post("/two-factor/verify-backup-code", phone, { code: backupCodes[0] })).status).toBe(401);
    expect((await me(phone))!.twoFactor.verifiedAt).toBeNull();
  });

  it("won't set up on a session signed in more than 10 minutes ago", async () => {
    const cookie = await signIn("stale@example.test");
    await t.db.update(session).set({ createdAt: new Date(Date.now() - 11 * 60_000) }).where(eq(session.id, await sessionIdOf(cookie)));
    const res = await post("/two-factor/enable", cookie);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe("fresh_sign_in_required");
  });

  it("needs a code from the last 10 minutes to turn off or replace", async () => {
    const { cookie } = await enrolledAdmin("disable@example.test");
    await setVerifiedAt(cookie, new Date(Date.now() - 11 * 60_000));
    for (const path of ["/two-factor/disable", "/two-factor/enable", "/two-factor/generate-backup-codes"]) {
      expect((await post(path, cookie)).status, path).toBe(403);
    }
    await setVerifiedAt(cookie, new Date());
    const off = await post("/two-factor/disable", cookie);
    expect(off.status).toBe(200);
    // Like turning it on, turning it off replaces the session.
    expect((await me(sessionCookie(off)!))!.twoFactor).toEqual({ enabled: false, verifiedAt: null });
  });

  it("caps codes tried per account, whatever the IP", async () => {
    const { cookie, totpURI } = await enrolledAdmin("guess@example.test");
    // The setup code above was the first of five.
    for (let i = 0; i < 4; i++) expect((await post("/two-factor/verify-totp", cookie, { code: "000000" })).status).not.toBe(429);
    const blocked = await post("/two-factor/verify-totp", cookie, { code: totp(totpURI) });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toMatch(/^\d+$/);
  });

  it("doesn't offer email codes or show the setup key again", async () => {
    const { cookie } = await enrolledAdmin("closed@example.test");
    for (const path of ["/two-factor/get-totp-uri", "/two-factor/send-otp", "/two-factor/verify-otp"]) {
      expect((await post(path, cookie)).status, path).toBe(404);
    }
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../../tests/support/db";
import { testDeps } from "../../../tests/support/deps";
import { createAsset, createUser } from "../../../tests/support/factories";
import { call } from "../../../tests/support/invoke";
import { assetHandlers } from "../assets/handlers";
import { databaseStorage, DATABASE_QUOTA_BYTES, signGrant, verifyGrant, writeObject } from "./database";
import { storageFileHandlers } from "./handlers";

const SECRET = "test-secret-that-is-at-least-32-characters-long";
const ORIGIN = "http://localhost:3000";

let t: TestDb;
let assets: ReturnType<typeof assetHandlers>;
let files: ReturnType<typeof storageFileHandlers>;
beforeAll(async () => {
  t = await createTestDb();
  const deps = testDeps(t.db);
  assets = assetHandlers(deps, databaseStorage({ db: t.db, secret: SECRET, origin: ORIGIN, now: () => new Date() }));
  files = storageFileHandlers(deps, true);
});
afterAll(() => t.close());

/** A tiny file that passes the JPEG signature check. */
const jpeg = (size = 64) => {
  const b = new Uint8Array(size);
  b.set([0xff, 0xd8, 0xff, 0xe0]);
  return b;
};
const body = (b: Uint8Array) => new Blob([b.slice().buffer]);
const pathOf = (url: string) => url.replace(ORIGIN, "");

describe("signed storage grants", () => {
  const now = new Date("2026-09-28T12:00:00Z");
  const grant = { op: "get" as const, b: "private" as const, k: "u/1/a", exp: now.getTime() + 60_000 };

  it("verify what they sign, and nothing else", () => {
    const token = signGrant(SECRET, grant);
    expect(verifyGrant(SECRET, token, now)).toEqual(grant);
    expect(verifyGrant("another-secret-that-is-at-least-32-chars", token, now)).toBeNull();
    const [body, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...grant, k: "u/2/b" })).toString("base64url");
    expect(verifyGrant(SECRET, `${forged}.${sig}`, now)).toBeNull();
    expect(verifyGrant(SECRET, `${body}.${sig}.x`, now)).toBeNull();
    expect(verifyGrant(SECRET, "", now)).toBeNull();
  });

  it("expire", () => {
    expect(verifyGrant(SECRET, signGrant(SECRET, grant), new Date(grant.exp + 1))).toBeNull();
  });
});

describe("database storage upload flow", () => {
  it("uploads through a signed URL, completes, and serves the photo back through a signed URL", async () => {
    const alice = await createUser(t.db);
    const bytes = jpeg(200);
    const ticket = await call(assets.requestUpload, { method: "POST", as: alice, body: { kind: "photo", mime: "image/jpeg", bytes: bytes.length } });
    expect(ticket.status).toBe(201);
    expect(ticket.body.upload.url).toMatch(/^http:\/\/localhost:3000\/api\/storage\/objects\?t=/);

    const put = await call(files.put, { method: "PUT", path: pathOf(ticket.body.upload.url), rawBody: body(bytes), headers: { "content-type": "image/jpeg" } });
    expect(put.status).toBe(200);

    const done = await call(assets.complete, { method: "POST", as: alice, params: { id: ticket.body.asset.id }, body: { width: 40, height: 30 } });
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ status: "ready", width: 40 });

    const resolved = await call(assets.resolve, { method: "POST", as: alice, body: { ids: [ticket.body.asset.id] } });
    const url: string = resolved.body.assets[0].url;
    // Read the raw bytes (the call helper decodes bodies as text).
    const got = await files.get(new Request(url), { params: Promise.resolve({}) });
    expect(got.status).toBe(200);
    expect(got.headers.get("content-type")).toBe("image/jpeg");
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(bytes);
  });

  it("refuses uploads that don't match their grant", async () => {
    const alice = await createUser(t.db);
    const ticket = await call(assets.requestUpload, { method: "POST", as: alice, body: { kind: "photo", mime: "image/jpeg", bytes: 100 } });
    const path = pathOf(ticket.body.upload.url);
    const put = (rawBody: Uint8Array, type = "image/jpeg", p = path, origin?: string | null) =>
      call(files.put, { method: "PUT", path: p, rawBody: body(rawBody), headers: { "content-type": type }, origin });
    expect((await put(jpeg(100), "image/png")).status).toBe(415);
    expect((await put(jpeg(101))).status).toBe(413);
    expect((await put(jpeg(99))).status).toBe(400);
    expect((await put(jpeg(100), "image/jpeg", "/api/storage/objects?t=forged.token")).status).toBe(403);
    expect((await put(jpeg(100), "image/jpeg", path, "https://evil.example")).status).toBe(403);
    // A download grant can't be used to upload, and an upload grant can't be used to download.
    const getGrant = signGrant(SECRET, { op: "get", b: "private", k: "x", exp: Date.now() + 60_000 });
    expect((await put(jpeg(100), "image/jpeg", `/api/storage/objects?t=${getGrant}`)).status).toBe(403);
    expect((await call(files.get, { path })).status).toBe(403);
  });

  it("gives each user the smaller database allowance", async () => {
    const alice = await createUser(t.db);
    await createAsset(t.db, { ownerId: alice.id, bytes: DATABASE_QUOTA_BYTES - 1000 });
    const res = await call(assets.requestUpload, { method: "POST", as: alice, body: { kind: "photo", mime: "image/jpeg", bytes: 2000 } });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ limitBytes: DATABASE_QUOTA_BYTES, detail: expect.stringMatching(/50 MB/) });
  });

  it("serves the public bucket by path, and nothing when an external bucket is in use", async () => {
    await writeObject(t.db, "public", "templates/t1/cover.jpg", "image/jpeg", jpeg(10));
    const deps = testDeps(t.db);
    expect((await call(files.getPublic, { path: "/api/storage/public/templates/t1/cover.jpg" })).status).toBe(200);
    expect((await call(files.getPublic, { path: "/api/storage/public/templates/t1/missing.jpg" })).status).toBe(404);
    const off = storageFileHandlers(deps, false);
    expect((await call(off.getPublic, { path: "/api/storage/public/templates/t1/cover.jpg" })).status).toBe(404);
  });
});

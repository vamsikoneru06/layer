import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../../tests/support/db";
import { testDeps } from "../../../tests/support/deps";
import { docWithPhoto, emptyDoc } from "../../../tests/support/docs";
import { createAsset, createDesign, createUser } from "../../../tests/support/factories";
import { call } from "../../../tests/support/invoke";
import { captureLogger } from "../../../tests/support/logger";
import { memoryStorage } from "../../../tests/support/storage";
import { testConfig } from "../../../tests/support/config";
import { designs, shareLinks } from "../db/schema";
import { shareHandlers } from "./handlers";

let t: TestDb;
let h: ReturnType<typeof shareHandlers>;
beforeAll(async () => {
  t = await createTestDb();
  h = shareHandlers(testDeps(t.db), memoryStorage());
});
afterAll(() => t.close());

const share = (as: { id: string } | null, designId: string) => call(h.create, { method: "POST", as, params: { id: designId } });
const view = (token: string, handlers = h) => call(handlers.view, { path: `/api/shared/${token}`, params: { token } });

describe("share links", () => {
  it("creates a link whose token is shown once and stored only as a hash", async () => {
    const alice = await createUser(t.db);
    const design = await createDesign(t.db, alice.id, emptyDoc());
    const res = await share(alice, design.id);
    expect(res.status).toBe(201);
    expect(res.body.token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(res.body.url).toBe(`${testConfig.appOrigin}/s/${res.body.token}`);
    const [row] = await t.db.select().from(shareLinks).where(eq(shareLinks.id, res.body.id));
    expect(row!.tokenHash).toBe(createHash("sha256").update(res.body.token).digest("hex"));
    expect(JSON.stringify(row)).not.toContain(res.body.token);
    const listed = await call(h.list, { as: alice, params: { id: design.id } });
    expect(listed.body).toEqual({ items: [{ id: res.body.id, createdAt: res.body.createdAt }] });
  });

  it("lets only the owner create, list or revoke links", async () => {
    const alice = await createUser(t.db);
    const bob = await createUser(t.db);
    const design = await createDesign(t.db, alice.id, emptyDoc());
    const { body } = await share(alice, design.id);
    expect((await share(bob, design.id)).status).toBe(404);
    expect((await share(null, design.id)).status).toBe(401);
    expect((await call(h.list, { as: bob, params: { id: design.id } })).status).toBe(404);
    expect((await call(h.revoke, { method: "DELETE", as: bob, params: { id: design.id, linkId: body.id } })).status).toBe(404);
    expect((await view(body.token)).status).toBe(200);
  });

  it("opens the design read-only, with signed URLs for its own photos only and no account details", async () => {
    const alice = await createUser(t.db, { name: "Alice", handle: `u_${randomUUID().slice(0, 8)}` });
    const inDoc = await createAsset(t.db, { ownerId: alice.id });
    const notInDoc = await createAsset(t.db, { ownerId: alice.id });
    const design = await createDesign(t.db, alice.id, docWithPhoto(inDoc.id));
    const { body } = await share(alice, design.id);
    const res = await view(body.token);
    expect(res.status).toBe(200);
    expect(res.body.design).toMatchObject({ title: design.title, format: "ig-post", width: 1080, height: 1080 });
    expect(res.body.design.doc.nodes.photo1.content.assetId).toBe(inDoc.id);
    expect(res.body.owner).toEqual({ name: "Alice", handle: alice.handle });
    expect(res.body.assets.map((a: { id: string }) => a.id)).toEqual([inDoc.id]);
    expect(res.body.assets[0].url).toContain("op=get");
    const text = JSON.stringify(res.body);
    // Signed URLs carry the storage key (u/{ownerId}/…), so only the email and unrelated assets are checked.
    for (const secret of [alice.email, notInDoc.id]) expect(text).not.toContain(secret);
  });

  it("answers 410 once revoked, and 404 for unknown, malformed or deleted ones", async () => {
    const alice = await createUser(t.db);
    const design = await createDesign(t.db, alice.id, emptyDoc());
    const { body } = await share(alice, design.id);
    const revoke = () => call(h.revoke, { method: "DELETE", as: alice, params: { id: design.id, linkId: body.id } });
    expect((await revoke()).status).toBe(204);
    expect((await revoke()).status).toBe(204);
    const gone = await view(body.token);
    expect(gone.status).toBe(410);
    expect(gone.body.detail).toMatch(/turned off/);
    expect((await call(h.list, { as: alice, params: { id: design.id } })).body.items).toEqual([]);
    expect((await view("A".repeat(22))).status).toBe(404);
    expect((await view("short")).status).toBe(404);

    const other = await createDesign(t.db, alice.id, emptyDoc());
    const live = (await share(alice, other.id)).body;
    await t.db.delete(designs).where(eq(designs.id, other.id));
    expect((await view(live.token)).status).toBe(404);
  });

  it("caps a design at 20 active links, so every link stays listable and revocable", async () => {
    const alice = await createUser(t.db);
    const design = await createDesign(t.db, alice.id, emptyDoc());
    const links = [];
    for (let i = 0; i < 20; i++) links.push((await share(alice, design.id)).body);
    const over = await share(alice, design.id);
    expect(over.status).toBe(422);
    expect(over.body.detail).toMatch(/20/);
    expect((await call(h.list, { as: alice, params: { id: design.id } })).body.items).toHaveLength(20);
    await call(h.revoke, { method: "DELETE", as: alice, params: { id: design.id, linkId: links[0].id } });
    expect((await share(alice, design.id)).status).toBe(201);
  });

  it("never writes the token to the logs", async () => {
    const alice = await createUser(t.db);
    const design = await createDesign(t.db, alice.id, emptyDoc());
    const { body } = await share(alice, design.id);
    const logger = captureLogger();
    const logged = shareHandlers(testDeps(t.db, { logger }), memoryStorage());
    await view(body.token, logged);
    await view("B".repeat(22), logged);
    expect(logger.entries.length).toBeGreaterThan(0);
    expect(JSON.stringify(logger.entries)).not.toContain(body.token);
  });

  it("still shows the design when storage isn't configured", async () => {
    const alice = await createUser(t.db);
    const photo = await createAsset(t.db, { ownerId: alice.id });
    const design = await createDesign(t.db, alice.id, docWithPhoto(photo.id));
    const { body } = await share(alice, design.id);
    const res = await view(body.token, shareHandlers(testDeps(t.db), null));
    expect(res.status).toBe(200);
    expect(res.body.assets).toEqual([]);
  });
});

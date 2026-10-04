import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../../tests/support/db";
import { testDeps } from "../../../tests/support/deps";
import { emptyDoc, templateDoc } from "../../../tests/support/docs";
import { createAsset, createDesign, createUser } from "../../../tests/support/factories";
import { call } from "../../../tests/support/invoke";
import { templateHandlers } from "./handlers";

let t: TestDb;
let h: ReturnType<typeof templateHandlers>;
beforeAll(async () => {
  t = await createTestDb();
  h = templateHandlers(testDeps(t.db));
});
afterAll(() => t.close());

const preflight = (as: { id: string } | null, body: Record<string, unknown>) => call(h.preflight, { method: "POST", as, body });

describe("POST /api/templates/preflight", () => {
  it("lists the draft's photos and scrubs every one that isn't kept", async () => {
    const alice = await createUser(t.db);
    const photo = await createAsset(t.db, { ownerId: alice.id });
    const draft = await createDesign(t.db, alice.id, templateDoc({ photoAssetId: photo.id }));
    const res = await preflight(alice, { designId: draft.id });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, issues: [], pii: [], photos: [{ assetId: photo.id, nodeIds: ["photo1"], yours: true }] });
    expect((await preflight(alice, { designId: draft.id, keep: [photo.id] })).body.ok).toBe(true);
  });

  it("warns about emails and phone numbers without blocking, and never echoes them whole", async () => {
    const alice = await createUser(t.db);
    const draft = await createDesign(t.db, alice.id, templateDoc({ heading: "Call 98765 43210 or mail riya@example.com" }));
    const res = await preflight(alice, { designId: draft.id });
    expect(res.body.ok).toBe(true);
    expect(res.body.pii.map((p: { kind: string }) => p.kind).sort()).toEqual(["email", "phone"]);
    expect(JSON.stringify(res.body)).not.toContain("riya@example.com");
  });

  it("reports template lint problems", async () => {
    const alice = await createUser(t.db);
    const doc = templateDoc();
    doc.nodes.heading!.lock = "locked";
    Object.assign(doc.nodes.photo1!, { placeholder: false });
    const draft = await createDesign(t.db, alice.id, doc);
    const res = await preflight(alice, { designId: draft.id });
    expect(res.body.ok).toBe(false);
    expect(res.body.issues.length).toBeGreaterThan(0);
  });

  it("only keeps the author's own ready photos that are in the draft", async () => {
    const alice = await createUser(t.db);
    const bob = await createUser(t.db);
    const bobs = await createAsset(t.db, { ownerId: bob.id });
    const pending = await createAsset(t.db, { ownerId: alice.id, status: "pending" });
    const withBobs = await createDesign(t.db, alice.id, templateDoc({ photoAssetId: bobs.id }));
    const withPending = await createDesign(t.db, alice.id, templateDoc({ photoAssetId: pending.id }));
    const foreign = await preflight(alice, { designId: withBobs.id, keep: [bobs.id] });
    expect(foreign.status).toBe(422);
    expect(foreign.body.detail).toMatch(/your own photos/);
    expect((await preflight(alice, { designId: withBobs.id })).body.photos).toEqual([{ assetId: bobs.id, nodeIds: ["photo1"], yours: false }]);
    expect((await preflight(alice, { designId: withPending.id, keep: [pending.id] })).status).toBe(422);
    const absent = await preflight(alice, { designId: withBobs.id, keep: [randomUUID()] });
    expect(absent.status).toBe(422);
    expect(absent.body.detail).toMatch(/in this template/);
  });

  it("only accepts the caller's template drafts", async () => {
    const alice = await createUser(t.db);
    const bob = await createUser(t.db);
    const plain = await createDesign(t.db, alice.id, emptyDoc());
    const draft = await createDesign(t.db, alice.id, templateDoc());
    expect((await preflight(alice, { designId: plain.id })).status).toBe(422);
    expect((await preflight(bob, { designId: draft.id })).status).toBe(404);
    expect((await preflight(null, { designId: draft.id })).status).toBe(401);
    expect((await preflight(alice, { designId: draft.id, keep: Array.from({ length: 11 }, () => randomUUID()) })).status).toBe(400);
  });
});

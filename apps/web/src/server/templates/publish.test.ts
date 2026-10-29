import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../../tests/support/db";
import { testDeps } from "../../../tests/support/deps";
import { templateDoc } from "../../../tests/support/docs";
import { createAsset, createDesign, createUser } from "../../../tests/support/factories";
import { call } from "../../../tests/support/invoke";
import { memoryStorage } from "../../../tests/support/storage";
import { assetHandlers } from "../assets/handlers";
import { storageUsedBytes } from "../assets/repository";
import { UPLOAD_LIMITS } from "../assets/service";
import { assets, designs, storageDeletions, templates, templateVersions } from "../db/schema";
import { meHandlers } from "../me/handlers";
import { templateHandlers } from "./handlers";

let t: TestDb;
let storage: ReturnType<typeof memoryStorage>;
let h: ReturnType<typeof templateHandlers>;
beforeAll(async () => {
  t = await createTestDb();
  storage = memoryStorage();
  h = templateHandlers(testDeps(t.db), storage);
});
afterAll(() => t.close());

const author = () => createUser(t.db, { handle: `u_${randomUUID().slice(0, 8)}` });
async function stored(ownerId: string, kind: "photo" | "thumbnail" = "photo") {
  const asset = await createAsset(t.db, { ownerId, kind, mime: kind === "photo" ? "image/jpeg" : "image/png" });
  storage.put("private", asset.storageKey, new Uint8Array(asset.bytes));
  return asset;
}
const publish = (as: { id: string } | null, body: Record<string, unknown>, handlers = h) =>
  call(handlers.publish, { method: "POST", as, body: { title: "Party", category: "celebrations", tags: ["Fun", "fun"], ...body } });
const versionOf = async (templateId: string, version = 1) =>
  (await t.db.select().from(templateVersions).where(eq(templateVersions.templateId, templateId))).find((v) => v.version === version)!;

describe("POST /api/templates", () => {
  it("publishes a draft with unkept photos scrubbed and a public, system-owned copy of the thumbnail", async () => {
    const alice = await author();
    const photo = await stored(alice.id);
    const thumb = await stored(alice.id, "thumbnail");
    const draft = await createDesign(t.db, alice.id, templateDoc({ photoAssetId: photo.id, heading: "Mail riya@example.com" }));
    const res = await publish(alice, { designId: draft.id, thumbnailAssetId: thumb.id });
    expect(res.status).toBe(201);
    const tpl = res.body.template;
    expect(tpl).toMatchObject({ title: "Party", tags: ["fun"], status: "published", currentVersion: 1, author: { handle: alice.handle } });
    expect(res.body.warnings.pii).toHaveLength(1);
    const version = await versionOf(tpl.id);
    expect(version.doc).toMatchObject({ id: tpl.id, kind: "template", assets: {} });
    expect(version.doc.nodes.photo1).toMatchObject({ content: null, placeholder: true });
    const [copy] = await t.db.select().from(assets).where(eq(assets.id, version.thumbnailAssetId!));
    expect(copy).toMatchObject({ ownerId: null, visibility: "public", status: "ready", kind: "thumbnail", templateId: tpl.id, storageKey: `t/${tpl.id}/${copy!.id}` });
    expect(storage.has("public", copy!.storageKey)).toBe(true);
    expect((await call(h.list, { path: "/api/templates?sort=new" })).body.items.map((i: { id: string }) => i.id)).toContain(tpl.id);
  });

  it("keeps an owned photo only with the ownership confirmation, as a copy that outlives the original", async () => {
    const alice = await author();
    const photo = await stored(alice.id);
    const thumb = await stored(alice.id, "thumbnail");
    const draft = await createDesign(t.db, alice.id, templateDoc({ photoAssetId: photo.id }));
    expect((await publish(alice, { designId: draft.id, thumbnailAssetId: thumb.id, keep: [photo.id] })).status).toBe(422);
    const res = await publish(alice, { designId: draft.id, thumbnailAssetId: thumb.id, keep: [photo.id], ownsKeptPhotos: true });
    expect(res.status).toBe(201);
    const doc = (await versionOf(res.body.template.id)).doc;
    const copyId = (doc.nodes.photo1 as { content: { assetId: string } }).content.assetId;
    expect(copyId).not.toBe(photo.id);
    expect(Object.keys(doc.assets)).toEqual([copyId]);
    const [copy] = await t.db.select().from(assets).where(eq(assets.id, copyId));
    expect(copy).toMatchObject({ ownerId: null, visibility: "public", templateId: res.body.template.id, bytes: photo.bytes });

    const assetApi = assetHandlers(testDeps(t.db), storage);
    expect((await call(assetApi.remove, { method: "DELETE", as: alice, params: { id: photo.id } })).status).toBe(204);
    const resolved = await call(assetApi.resolve, { method: "POST", body: { ids: [copyId] } });
    expect(resolved.body.assets).toEqual([{ id: copyId, url: `https://cdn.test/${copy!.storageKey}`, expiresAt: null }]);
  });

  it("refuses authors without a handle, drafts with problems, and thumbnails that aren't theirs", async () => {
    const alice = await author();
    const bob = await author();
    const noHandle = await createUser(t.db);
    const thumb = await stored(alice.id, "thumbnail");
    const photo = await stored(alice.id);
    const draft = await createDesign(t.db, alice.id, templateDoc());
    const broken = templateDoc();
    broken.nodes.heading!.lock = "locked";
    Object.assign(broken.nodes.photo1!, { placeholder: false });
    const brokenDraft = await createDesign(t.db, alice.id, broken);
    const theirDraft = await createDesign(t.db, noHandle.id, templateDoc());
    const theirThumb = await stored(noHandle.id, "thumbnail");

    expect((await publish(noHandle, { designId: theirDraft.id, thumbnailAssetId: theirThumb.id })).body.detail).toMatch(/handle/);
    const lint = await publish(alice, { designId: brokenDraft.id, thumbnailAssetId: thumb.id });
    expect(lint.status).toBe(422);
    expect(lint.body.issues.length).toBeGreaterThan(0);
    expect((await publish(alice, { designId: draft.id, thumbnailAssetId: photo.id })).status).toBe(422);
    expect((await publish(bob, { designId: draft.id, thumbnailAssetId: thumb.id })).status).toBe(404);
    expect((await publish(null, { designId: draft.id, thumbnailAssetId: thumb.id })).status).toBe(401);
    expect((await publish(alice, { designId: draft.id, thumbnailAssetId: thumb.id, category: "weddings" })).status).toBe(400);
  });

  it("counts published copies toward the author's quota, and refuses to go over it", async () => {
    const alice = await author();
    const thumb = await stored(alice.id, "thumbnail");
    const draft = await createDesign(t.db, alice.id, templateDoc());
    const before = await storageUsedBytes(t.db, alice.id);
    expect((await publish(alice, { designId: draft.id, thumbnailAssetId: thumb.id })).status).toBe(201);
    expect(await storageUsedBytes(t.db, alice.id)).toBe(before + thumb.bytes);

    const bob = await author();
    await createAsset(t.db, { ownerId: bob.id, bytes: UPLOAD_LIMITS.storageQuotaBytes - 1500 });
    const bobThumb = await stored(bob.id, "thumbnail");
    const bobDraft = await createDesign(t.db, bob.id, templateDoc());
    const publicObjects = () => [...storage.objects.keys()].filter((k) => k.startsWith("public:")).length;
    const publicBefore = publicObjects();
    expect((await publish(bob, { designId: bobDraft.id, thumbnailAssetId: bobThumb.id })).status).toBe(422);
    expect(await t.db.select().from(templates).where(eq(templates.authorId, bob.id))).toEqual([]);
    expect(publicObjects()).toBe(publicBefore);
  });

  it("leaves no half-published template when storage fails, and queues what it copied", async () => {
    const alice = await author();
    const photo = await stored(alice.id);
    const thumb = await stored(alice.id, "thumbnail");
    const draft = await createDesign(t.db, alice.id, templateDoc({ photoAssetId: photo.id }));
    const queuedBefore = new Set((await t.db.select().from(storageDeletions)).map((r) => r.id));
    storage.failCopy.add(thumb.storageKey);
    const res = await publish(alice, { designId: draft.id, thumbnailAssetId: thumb.id, keep: [photo.id], ownsKeptPhotos: true });
    storage.failCopy.delete(thumb.storageKey);
    expect(res.status).toBe(503);
    expect(await t.db.select().from(templates).where(eq(templates.authorId, alice.id))).toEqual([]);
    const queued = (await t.db.select().from(storageDeletions)).filter((r) => !queuedBefore.has(r.id));
    expect(queued).toHaveLength(2);
    expect(queued.every((r) => r.bucket === "public" && r.storageKey.startsWith("t/"))).toBe(true);
  });

  it("allows 5 publishes a day", async () => {
    const alice = await author();
    const thumb = await stored(alice.id, "thumbnail");
    const draft = await createDesign(t.db, alice.id, templateDoc());
    const fixed = templateHandlers(testDeps(t.db, { now: () => new Date("2026-09-26T10:00:00Z") }), storage);
    for (let i = 0; i < 5; i++) expect((await publish(alice, { designId: draft.id, thumbnailAssetId: thumb.id }, fixed)).status).toBe(201);
    expect((await publish(alice, { designId: draft.id, thumbnailAssetId: thumb.id }, fixed)).status).toBe(429);
  });

  it("removes an author's templates with their account and queues the published copies", async () => {
    const alice = await author();
    const thumb = await stored(alice.id, "thumbnail");
    const draft = await createDesign(t.db, alice.id, templateDoc());
    const { body } = await publish(alice, { designId: draft.id, thumbnailAssetId: thumb.id });
    const copyKey = `t/${body.template.id}/${(await versionOf(body.template.id)).thumbnailAssetId}`;
    expect((await call(meHandlers(testDeps(t.db)).remove, { method: "DELETE", as: alice, body: { confirm: alice.email } })).status).toBe(204);
    expect(await t.db.select().from(templates).where(eq(templates.id, body.template.id))).toEqual([]);
    expect(await t.db.select().from(assets).where(eq(assets.templateId, body.template.id))).toEqual([]);
    expect((await t.db.select().from(storageDeletions).where(eq(storageDeletions.storageKey, copyKey))).map((r) => r.bucket)).toEqual(["public"]);
  });
});

describe("POST /api/templates/:id/versions", () => {
  it("reuses the copies of photos it already published, so a republish doesn't charge the quota again", async () => {
    const alice = await author();
    const photo = await stored(alice.id);
    const thumb = await stored(alice.id, "thumbnail");
    const draft = await createDesign(t.db, alice.id, templateDoc({ photoAssetId: photo.id }));
    const body = { designId: draft.id, thumbnailAssetId: thumb.id, keep: [photo.id], ownsKeptPhotos: true };
    const first = await publish(alice, body);
    const id = first.body.template.id;
    const used = await storageUsedBytes(t.db, alice.id);
    const publicObjects = [...storage.objects.keys()].filter((k) => k.startsWith("public:")).length;

    const next = await call(h.publishVersion, { method: "POST", as: alice, params: { id }, body: { ...body, title: "Party, fixed typo", category: "celebrations" } });
    expect(next.status).toBe(201);
    expect(await storageUsedBytes(t.db, alice.id)).toBe(used);
    expect([...storage.objects.keys()].filter((k) => k.startsWith("public:")).length).toBe(publicObjects);
    const [v1, v2] = [await versionOf(id, 1), await versionOf(id, 2)];
    expect(Object.keys(v2.doc.assets)).toEqual(Object.keys(v1.doc.assets));
    expect(v2.thumbnailAssetId).toBe(v1.thumbnailAssetId);
  });

  it("publishes a new version for the author only, leaving earlier versions and designs alone", async () => {
    const alice = await author();
    const bob = await author();
    const thumb = await stored(alice.id, "thumbnail");
    const draft = await createDesign(t.db, alice.id, templateDoc());
    const { body } = await publish(alice, { designId: draft.id, thumbnailAssetId: thumb.id });
    const id = body.template.id;
    const used = await call(h.use, { method: "POST", as: bob, params: { id } });
    await t.db.update(templates).set({ status: "hidden" }).where(eq(templates.id, id));

    const next = await call(h.publishVersion, { method: "POST", as: alice, params: { id }, body: { designId: draft.id, thumbnailAssetId: thumb.id, title: "Party v2", category: "events" } });
    expect(next.status).toBe(201);
    expect(next.body.template).toMatchObject({ title: "Party v2", category: "events", currentVersion: 2, status: "hidden" });
    expect((await versionOf(id, 1)).doc.meta.title).toBe("Party");
    const [design] = await t.db.select().from(designs).where(eq(designs.id, used.body.id));
    expect(design?.sourceTemplateVersion).toBe(1);

    const bobsDraft = await createDesign(t.db, bob.id, templateDoc());
    const bobsThumb = await stored(bob.id, "thumbnail");
    expect((await call(h.publishVersion, { method: "POST", as: bob, params: { id }, body: { designId: bobsDraft.id, thumbnailAssetId: bobsThumb.id, title: "Mine", category: "events" } })).status).toBe(404);
  });
});

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../../tests/support/db";
import { testDeps } from "../../../tests/support/deps";
import { createAsset, createUser } from "../../../tests/support/factories";
import { call } from "../../../tests/support/invoke";
import { assets, brandKits, user } from "../db/schema";
import { meHandlers } from "../me/handlers";
import { brandKitHandlers } from "./handlers";

let t: TestDb;
let h: ReturnType<typeof brandKitHandlers>;
beforeAll(async () => {
  t = await createTestDb();
  h = brandKitHandlers(testDeps(t.db));
});
afterAll(() => t.close());

const save = (as: { id: string }, body: unknown) => call(h.put, { method: "PUT", as, body });
const load = (as: { id: string }) => call(h.get, { as });

describe("brand kit", () => {
  it("starts empty, and saves colours (normalised, no repeats), fonts and a logo", async () => {
    const alice = await createUser(t.db);
    expect((await load(alice)).body).toEqual({ colors: [], fonts: [], logoAssetId: null });

    const logo = await createAsset(t.db, { ownerId: alice.id });
    const saved = await save(alice, { colors: ["#ff7a1a", "#1D1B18", "#FF7A1A"], fonts: ["Playfair Display", "Inter"], logoAssetId: logo.id });
    expect(saved.status).toBe(200);
    expect(saved.body).toEqual({ colors: ["#FF7A1A", "#1D1B18"], fonts: ["Playfair Display", "Inter"], logoAssetId: logo.id });
    expect((await load(alice)).body).toEqual(saved.body);

    // A second save replaces the kit.
    expect((await save(alice, { colors: [], fonts: ["Lora"], logoAssetId: null })).body).toEqual({ colors: [], fonts: ["Lora"], logoAssetId: null });
  });

  it("rejects colours that aren't #RRGGBB, unknown or repeated fonts, and too many of either", async () => {
    const bob = await createUser(t.db);
    for (const body of [
      { colors: ["red"], fonts: [], logoAssetId: null },
      { colors: ["#12345"], fonts: [], logoAssetId: null },
      { colors: Array.from({ length: 13 }, (_, i) => `#0000${String(i).padStart(2, "0")}`), fonts: [], logoAssetId: null },
      { colors: [], fonts: ["Comic Sans MS"], logoAssetId: null },
      { colors: [], fonts: ["Inter", "Inter"], logoAssetId: null },
      { colors: [], fonts: ["Inter", "Lora", "Oswald", "Poppins", "Roboto"], logoAssetId: null },
      { colors: [], fonts: [], logoAssetId: null, extra: true },
    ]) {
      expect((await save(bob, body)).status, JSON.stringify(body)).toBe(400);
    }
    expect((await load(bob)).body).toEqual({ colors: [], fonts: [], logoAssetId: null });
  });

  it("only takes one of your own ready photos as the logo", async () => {
    const carol = await createUser(t.db);
    const dave = await createUser(t.db);
    const daves = await createAsset(t.db, { ownerId: dave.id });
    const pending = await createAsset(t.db, { ownerId: carol.id, status: "pending" });
    const sticker = await createAsset(t.db, { ownerId: null, kind: "sticker", visibility: "public" });
    for (const logoAssetId of [daves.id, pending.id, sticker.id, "00000000-0000-4000-8000-000000000000"]) {
      expect((await save(carol, { colors: [], fonts: [], logoAssetId })).status, logoAssetId).toBe(422);
    }
  });

  it("forgets the logo when its photo is deleted, and goes with the account", async () => {
    const erin = await createUser(t.db);
    const logo = await createAsset(t.db, { ownerId: erin.id });
    await save(erin, { colors: ["#000000"], fonts: [], logoAssetId: logo.id });
    await t.db.delete(assets).where(eq(assets.id, logo.id));
    expect((await load(erin)).body).toEqual({ colors: ["#000000"], fonts: [], logoAssetId: null });
    await t.db.delete(user).where(eq(user.id, erin.id));
    expect(await t.db.select().from(brandKits).where(eq(brandKits.userId, erin.id))).toEqual([]);
  });

  it("keeps each kit to its owner, and includes it in the account export", async () => {
    const frank = await createUser(t.db);
    const grace = await createUser(t.db);
    await save(frank, { colors: ["#123456"], fonts: ["Oswald"], logoAssetId: null });
    expect((await load(grace)).body).toEqual({ colors: [], fonts: [], logoAssetId: null });
    expect((await call(h.get, {})).status).toBe(401);

    const exported = await call(meHandlers(testDeps(t.db)).export, { as: frank });
    expect(exported.body.brandKit).toEqual({ colors: ["#123456"], fonts: ["Oswald"], logoAssetId: null });
  });
});

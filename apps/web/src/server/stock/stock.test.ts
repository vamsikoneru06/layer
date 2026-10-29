import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb, type TestDb } from "../../../tests/support/db";
import { testDeps } from "../../../tests/support/deps";
import { createUser } from "../../../tests/support/factories";
import { call } from "../../../tests/support/invoke";
import { stockHandlers } from "./handlers";
import { isPexelsImage, pexelsClient } from "./pexels";

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(() => t.close());

const IMG = "https://images.pexels.com/photos/1/pexels-photo-1.jpeg?auto=compress&h=350";
const raw = {
  id: 1,
  width: 4000,
  height: 3000,
  alt: "A beach",
  photographer: "Asha Rao",
  photographer_url: "https://www.pexels.com/@asha",
  url: "https://www.pexels.com/photo/1/",
  avg_color: "#AABBCC",
  src: { medium: IMG, large2x: IMG.replace("h=350", "h=1880") },
};

function pexelsApi(photos: unknown[] = [raw]) {
  return vi.fn(async (_url: URL | RequestInfo, _init?: RequestInit) => Response.json({ photos, next_page: "https://api.pexels.com/v1/search?page=2" }));
}

describe("isPexelsImage", () => {
  it("allows only https files on Pexels' image host", () => {
    expect(isPexelsImage(IMG)).toBe(true);
    for (const bad of [
      "http://images.pexels.com/photos/1/a.jpeg",
      "https://images.pexels.com.evil.example/photos/1/a.jpeg",
      "https://evil.example/photos/1/a.jpeg",
      "https://images.pexels.com:8443/photos/1/a.jpeg",
      "https://user@images.pexels.com/photos/1/a.jpeg",
      "https://images.pexels.com/videos/1.mp4",
      "file:///etc/passwd",
      "not a url",
    ]) {
      expect(isPexelsImage(bad)).toBe(false);
    }
  });
});

describe("pexelsClient", () => {
  it("sends the key, maps each photo with its credit, and caches answers for an hour", async () => {
    const fetch = pexelsApi([raw, { ...raw, id: 2, src: { medium: "https://evil.example/photos/x.jpg", large2x: IMG } }]);
    let now = 0;
    const client = pexelsClient("test-key", { fetch, now: () => now });
    const page = await client.search("Beach", 1);
    expect(page).toEqual({
      photos: [
        { id: 1, width: 4000, height: 3000, alt: "A beach", photographer: "Asha Rao", photographerUrl: "https://www.pexels.com/@asha", pageUrl: "https://www.pexels.com/photo/1/", color: "#AABBCC", thumb: IMG, full: raw.src.large2x },
      ],
      nextPage: 2,
    });
    expect((fetch.mock.calls[0]![1]!.headers as Record<string, string>).Authorization).toBe("test-key");
    await client.search("beach", 1);
    expect(fetch).toHaveBeenCalledTimes(1);
    now = 61 * 60 * 1000;
    await client.search("beach", 1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe("stock endpoints", () => {
  it("need a signed-in user, and say so when search isn't set up", async () => {
    const h = stockHandlers(testDeps(t.db), pexelsClient("k", { fetch: pexelsApi() }));
    expect((await call(h.search, { path: "/api/stock/search?q=beach" })).status).toBe(401);
    const user = await createUser(t.db);
    const off = stockHandlers(testDeps(t.db), null);
    expect((await call(off.search, { path: "/api/stock/search?q=beach", as: user })).status).toBe(503);
    expect((await call(off.image, { path: `/api/stock/image?src=${encodeURIComponent(IMG)}`, as: user })).status).toBe(503);
  });

  it("searches", async () => {
    const user = await createUser(t.db);
    const h = stockHandlers(testDeps(t.db), pexelsClient("k", { fetch: pexelsApi() }));
    const res = await call(h.search, { path: "/api/stock/search?q=beach&page=1", as: user });
    expect(res.status).toBe(200);
    expect(res.body.photos[0]).toMatchObject({ id: 1, photographer: "Asha Rao" });
    expect((await call(h.search, { path: "/api/stock/search?q=", as: user })).status).toBe(400);
  });

  it("passes through Pexels photos only, never fetching anything else", async () => {
    const user = await createUser(t.db);
    const files = vi.fn(async () => new Response(new Uint8Array([0xff, 0xd8, 0xff]), { headers: { "content-type": "image/jpeg" } }));
    const h = stockHandlers(testDeps(t.db), pexelsClient("k", { fetch: pexelsApi() }), files);
    const ok = await call(h.image, { path: `/api/stock/image?src=${encodeURIComponent(IMG)}`, as: user });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("image/jpeg");
    expect(files).toHaveBeenCalledWith(IMG, expect.objectContaining({ redirect: "error" }));

    files.mockClear();
    const bad = await call(h.image, { path: `/api/stock/image?src=${encodeURIComponent("http://169.254.169.254/latest/meta-data")}`, as: user });
    expect(bad.status).toBe(400);
    expect(files).not.toHaveBeenCalled();
  });

  it("refuses files that aren't images", async () => {
    const user = await createUser(t.db);
    const html = vi.fn(async () => new Response("<script>", { headers: { "content-type": "text/html" } }));
    const h = stockHandlers(testDeps(t.db), pexelsClient("k", { fetch: pexelsApi() }), html);
    expect((await call(h.image, { path: `/api/stock/image?src=${encodeURIComponent(IMG)}`, as: user })).status).toBe(502);
  });
});

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../../tests/support/db";
import { testConfig } from "../../../tests/support/config";
import { testDeps } from "../../../tests/support/deps";
import { createTemplate } from "../../../tests/support/factories";
import { call } from "../../../tests/support/invoke";
import { templates } from "../db/schema";
import { robotsTxt, seoHandlers, sitemapXml } from "./handlers";

let t: TestDb;
let h: ReturnType<typeof seoHandlers>;
beforeAll(async () => {
  t = await createTestDb();
  h = seoHandlers(testDeps(t.db));
});
beforeEach(async () => {
  await t.db.delete(templates);
});
afterAll(() => t.close());

const origin = testConfig.appOrigin;

describe("GET /sitemap.xml", () => {
  it("lists the public pages and every published template, never hidden ones", async () => {
    const shown = await createTemplate(t.db, { updatedAt: new Date("2026-10-01T00:00:00Z") });
    const hidden = await createTemplate(t.db, { status: "hidden" });
    const res = await call(h.sitemap, { path: "/sitemap.xml" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/xml");
    expect(res.headers.get("cache-control")).toContain("s-maxage");
    expect(res.body).toContain(`<loc>${origin}/</loc>`);
    expect(res.body).toContain(`<loc>${origin}/templates</loc>`);
    expect(res.body).toContain(`<loc>${origin}/cookies</loc>`);
    expect(res.body).toContain(`<loc>${origin}/templates/${shown.id}</loc><lastmod>2026-10-01T00:00:00.000Z</lastmod>`);
    expect(res.body).not.toContain(hidden.id);
  });

  it("never lists signed-in screens", async () => {
    const res = await call(h.sitemap, { path: "/sitemap.xml" });
    for (const path of ["/home", "/designs", "/media", "/settings", "/edit", "/dev", "/api"]) expect(res.body).not.toContain(`${origin}${path}`);
  });
});

describe("sitemapXml", () => {
  it("escapes XML in URLs", () => {
    expect(sitemapXml("https://a.test", [])).not.toContain("&<");
    expect(sitemapXml("https://a.test?x=1&y=2", [])).toContain("https://a.test?x=1&amp;y=2/");
  });
});

describe("GET /robots.txt", () => {
  it("keeps crawlers out of private paths and points at the sitemap", async () => {
    const res = await call(h.robots, { path: "/robots.txt" });
    expect(res.status).toBe(200);
    expect(res.body).toContain("Disallow: /api/");
    expect(res.body).toContain("Disallow: /edit/");
    expect(res.body).toContain(`Sitemap: ${origin}/sitemap.xml`);
    expect(robotsTxt("https://vash.test")).toContain("Sitemap: https://vash.test/sitemap.xml");
  });
});

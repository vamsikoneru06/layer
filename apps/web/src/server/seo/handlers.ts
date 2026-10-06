import type { Deps } from "../deps";
import { endpoint } from "../http/endpoint";
import { RATE_LIMITS } from "../rate-limit/rules";
import { listPublishedTemplateUrls } from "../templates/repository";

const publicRead = { name: "publicRead", rule: RATE_LIMITS.publicRead, by: "ip" } as const;

/** Pages anyone can open without signing in. Account pages, the editor, /dev and the API stay out. */
export const PUBLIC_PAGES = ["/", "/templates", "/terms", "/privacy"] as const;

/** Paths crawlers should skip: signed-in screens, the editor, development pages and the API. */
export const PRIVATE_PATHS = ["/api/", "/edit/", "/dev/", "/home", "/designs", "/media", "/settings", "/signin"] as const;

/** A sitemap holds at most 50,000 URLs; past that it needs an index file, which VASH is far from needing. */
export const SITEMAP_TEMPLATE_LIMIT = 50_000 - PUBLIC_PAGES.length;

/** Crawlers may fetch these hourly; the CDN serves repeats without touching the database. */
const CACHE = "public, max-age=3600, s-maxage=3600";

const escapeXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function sitemapXml(origin: string, templates: readonly { id: string; updatedAt: Date }[]): string {
  const urls = [
    ...PUBLIC_PAGES.map((path) => `  <url><loc>${escapeXml(origin + path)}</loc></url>`),
    ...templates.map(
      (t) => `  <url><loc>${escapeXml(`${origin}/templates/${t.id}`)}</loc><lastmod>${t.updatedAt.toISOString()}</lastmod></url>`,
    ),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
}

export function robotsTxt(origin: string): string {
  return ["User-agent: *", "Allow: /", ...PRIVATE_PATHS.map((p) => `Disallow: ${p}`), "", `Sitemap: ${origin}/sitemap.xml`, ""].join("\n");
}

export function seoHandlers(deps: Deps) {
  const origin = deps.config.appOrigin;
  return {
    sitemap: endpoint(deps, { auth: "none", rateLimit: publicRead }, async () => {
      const templates = await listPublishedTemplateUrls(deps.db, SITEMAP_TEMPLATE_LIMIT);
      return new Response(sitemapXml(origin, templates), {
        headers: { "content-type": "application/xml; charset=utf-8", "cache-control": CACHE },
      });
    }),
    robots: endpoint(deps, { auth: "none" }, async () =>
      new Response(robotsTxt(origin), { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": CACHE } }),
    ),
  };
}

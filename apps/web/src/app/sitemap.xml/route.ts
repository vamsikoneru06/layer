import { route } from "@/server/context";

// Next prerenders metadata routes (robots.txt, sitemap.xml) at build time by default; this one needs the runtime environment.
export const dynamic = "force-dynamic";

export const GET = route((app) => app.seo.sitemap);

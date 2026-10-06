import { CATEGORIES, FORMATS } from "@vash/schema";
import type { TemplateSort } from "./api";

/** The gallery's filters as they appear in its URL, so a filtered view can be linked and shared. */
export interface GalleryFilters {
  q: string;
  category: string | null;
  format: string;
  sort: TemplateSort;
}

const SORTS: readonly TemplateSort[] = ["popular", "new", "featured"];

/** Unknown values fall back to the defaults instead of sending the API a filter it would reject. */
export function readGalleryParams(params: URLSearchParams): GalleryFilters {
  const category = params.get("category");
  const format = params.get("format") ?? "";
  const sort = params.get("sort") as TemplateSort | null;
  return {
    q: (params.get("q") ?? "").slice(0, 100),
    category: category && CATEGORIES.includes(category) ? category : null,
    format: format in FORMATS ? format : "",
    sort: sort && SORTS.includes(sort) ? sort : "popular",
  };
}

/** Only non-default values, so the plain gallery stays at /templates. */
export function galleryQuery(f: GalleryFilters): string {
  const params = new URLSearchParams();
  if (f.q) params.set("q", f.q);
  if (f.category) params.set("category", f.category);
  if (f.format) params.set("format", f.format);
  if (f.sort !== "popular") params.set("sort", f.sort);
  const s = params.toString();
  return s ? `?${s}` : "";
}

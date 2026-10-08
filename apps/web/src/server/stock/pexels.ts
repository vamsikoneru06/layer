/** A Pexels photo as the editor shows it, with the credit Pexels asks for. */
export interface StockPhoto {
  id: number;
  width: number;
  height: number;
  alt: string;
  photographer: string;
  photographerUrl: string;
  pageUrl: string;
  /** Average colour, shown while the thumbnail loads. */
  color: string;
  thumb: string;
  /** Large enough for any design (about 1880 px on the long side), small enough to upload. */
  full: string;
}

export interface StockPage {
  photos: StockPhoto[];
  nextPage: number | null;
}

/** Where photo files may come from; the image proxy fetches nothing else. */
export const PEXELS_IMAGE_HOST = "images.pexels.com";

export function isPexelsImage(src: string): boolean {
  try {
    const u = new URL(src);
    return u.protocol === "https:" && u.hostname === PEXELS_IMAGE_HOST && u.port === "" && !u.username && !u.password && u.pathname.startsWith("/photos/");
  } catch {
    return false;
  }
}

export class PexelsError extends Error {
  constructor(readonly status: number) {
    super(`Pexels answered ${status}`);
  }
}

interface RawPhoto {
  id: number;
  width: number;
  height: number;
  alt?: string;
  photographer: string;
  photographer_url: string;
  url: string;
  avg_color?: string;
  src: { medium: string; large2x: string };
}

const PER_PAGE = 24;
const CACHE_MS = 60 * 60 * 1000;
const CACHE_MAX = 300;

/** Search over the Pexels API. Answers are cached for an hour, as Pexels allows the app only 200 calls an hour. */
export function pexelsClient(apiKey: string, o: { fetch?: typeof fetch; now?: () => number } = {}) {
  const fetchImpl = o.fetch ?? fetch;
  const now = o.now ?? Date.now;
  const cache = new Map<string, { at: number; page: StockPage }>();

  return {
    async search(query: string, page: number): Promise<StockPage> {
      const key = `${query.toLowerCase()}\n${page}`;
      const hit = cache.get(key);
      if (hit && now() - hit.at < CACHE_MS) return hit.page;

      const url = new URL("https://api.pexels.com/v1/search");
      url.search = new URLSearchParams({ query, page: String(page), per_page: String(PER_PAGE) }).toString();
      const res = await fetchImpl(url, { headers: { Authorization: apiKey }, redirect: "error", signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new PexelsError(res.status);
      const body = (await res.json()) as { photos?: RawPhoto[]; next_page?: string };
      const result: StockPage = {
        photos: (body.photos ?? [])
          .filter((p) => isPexelsImage(p.src?.medium ?? "") && isPexelsImage(p.src?.large2x ?? ""))
          .map((p) => ({
            id: p.id,
            width: p.width,
            height: p.height,
            alt: p.alt ?? "",
            photographer: p.photographer,
            photographerUrl: p.photographer_url,
            pageUrl: p.url,
            color: /^#[0-9a-f]{6}$/i.test(p.avg_color ?? "") ? p.avg_color! : "#8E8E93",
            thumb: p.src.medium,
            full: p.src.large2x,
          })),
        nextPage: body.next_page ? page + 1 : null,
      };
      if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
      cache.set(key, { at: now(), page: result });
      return result;
    },
  };
}

export type PexelsClient = ReturnType<typeof pexelsClient>;

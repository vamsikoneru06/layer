import { useEffect, useState } from "react";
import { resolveAssets } from "./api";

/** The resolve endpoint takes at most this many ids per request. */
const BATCH = 200;
/** Ask again this long before a signed URL expires, so an image never loads from a dead one. */
const EARLY_MS = 60_000;

type Entry = { url: string | null; until: number };

/**
 * Short-lived URLs for showing assets in lists. Ids asked for in the same tick are resolved together,
 * and each answer is kept until shortly before its URL expires. `null` means the asset is gone.
 */
export function createAssetUrls(resolve = resolveAssets, now = () => Date.now()) {
  const cache = new Map<string, Entry>();
  const waiting = new Map<string, ((url: string | null) => void)[]>();
  let scheduled = false;

  async function flush() {
    scheduled = false;
    const ids = [...waiting.keys()];
    for (let i = 0; i < ids.length; i += BATCH) {
      const chunk = ids.slice(i, i + BATCH);
      const found = new Map<string, Entry>();
      try {
        const { assets } = await resolve(chunk);
        for (const a of assets) found.set(a.id, { url: a.url, until: a.expiresAt ? Date.parse(a.expiresAt) - EARLY_MS : Infinity });
      } catch {
        // Unreachable: show nothing now and ask again next time.
        for (const id of chunk) for (const done of waiting.get(id) ?? []) done(null);
        for (const id of chunk) waiting.delete(id);
        continue;
      }
      for (const id of chunk) {
        const entry = found.get(id) ?? { url: null, until: now() + 5 * 60_000 };
        cache.set(id, entry);
        for (const done of waiting.get(id) ?? []) done(entry.url);
        waiting.delete(id);
      }
    }
  }

  return {
    /** The cached URL if it's still good, else undefined (call `get`). */
    peek(id: string): string | null | undefined {
      const hit = cache.get(id);
      return hit && hit.until > now() ? hit.url : undefined;
    },
    get(id: string): Promise<string | null> {
      const hit = this.peek(id);
      if (hit !== undefined) return Promise.resolve(hit);
      return new Promise((done) => {
        waiting.set(id, [...(waiting.get(id) ?? []), done]);
        if (!scheduled) {
          scheduled = true;
          queueMicrotask(() => void flush());
        }
      });
    },
  };
}

const shared = createAssetUrls();

/** A signed URL for an asset, or null while it loads and when there is none. */
export function useAssetUrl(id: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(() => (id ? (shared.peek(id) ?? null) : null));
  useEffect(() => {
    if (!id) return setUrl(null);
    let live = true;
    void shared.get(id).then((u) => live && setUrl(u));
    return () => {
      live = false;
    };
  }, [id]);
  return url;
}

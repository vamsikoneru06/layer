import type { ImageState } from "@vash/engine";
import { resolveAssets } from "./api";

/** Photos are decoded once into a working copy no larger than this on its long side (spec §7). */
export const WORKING_MAX_SIDE = 2048;

async function decode(blob: Blob): Promise<ImageBitmap> {
  const full = await createImageBitmap(blob);
  const long = Math.max(full.width, full.height);
  if (long <= WORKING_MAX_SIDE) return full;
  const scale = WORKING_MAX_SIDE / long;
  const small = await createImageBitmap(full, { resizeWidth: Math.round(full.width * scale), resizeHeight: Math.round(full.height * scale), resizeQuality: "high" });
  full.close();
  return small;
}

/**
 * Images by asset id for the renderer. Ids asked for in the same tick are resolved in one request,
 * each photo is fetched and decoded once, and `onChange` runs whenever photos arrive so the caller
 * can redraw. Unknown or unreachable assets become "missing".
 */
export function createImageLoader(onChange: () => void) {
  const states = new Map<string, ImageState>();
  let queued = new Set<string>();
  let scheduled = false;

  async function flush() {
    scheduled = false;
    const ids = [...queued];
    queued = new Set();
    const found = new Set<string>();
    try {
      const { assets } = await resolveAssets(ids);
      await Promise.all(
        assets.map(async (a) => {
          found.add(a.id);
          try {
            const res = await fetch(a.url);
            if (!res.ok) throw new Error(String(res.status));
            const bitmap = await decode(await res.blob());
            states.set(a.id, { source: bitmap, width: bitmap.width, height: bitmap.height });
          } catch {
            states.set(a.id, "missing");
          }
        }),
      );
    } catch {
      // The lookup itself failed (offline, or storage not set up for these photos).
    }
    for (const id of ids) if (!found.has(id)) states.set(id, "missing");
    onChange();
  }

  return {
    image(assetId: string): ImageState {
      const state = states.get(assetId);
      if (state) return state;
      states.set(assetId, "loading");
      queued.add(assetId);
      if (!scheduled) {
        scheduled = true;
        queueMicrotask(() => void flush());
      }
      return "loading";
    },
  };
}

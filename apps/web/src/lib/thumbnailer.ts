/**
 * Keeps a design's preview image current without getting in the way: after a save, once editing has
 * paused for `delayMs`, it renders and uploads a new preview, but only if the design changed since the
 * last one. One at a time; a failure just waits for the next save.
 */
export function createThumbnailer<D>(o: { delayMs: number; make: (doc: D) => Promise<void> }) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: D | null = null;
  let done: D | null = null;
  let running = false;
  let disposed = false;

  async function run() {
    timer = null;
    if (disposed || running || pending === null || pending === done) return;
    const doc = pending;
    running = true;
    try {
      await o.make(doc);
      done = doc;
    } catch {
      // Best effort: the next save tries again.
    } finally {
      running = false;
      if (!disposed && pending !== done && pending !== doc) schedule();
    }
  }

  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void run(), o.delayMs);
  }

  return {
    /** The document as just saved. */
    saved(doc: D) {
      if (disposed) return;
      pending = doc;
      schedule();
    },
    dispose() {
      disposed = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

/** Longest side of a design's preview image, in pixels: sharp on a card, small to store. */
export const THUMBNAIL_SIDE = 480;

/** Re-encodes an exported PNG as WebP (PNG where the browser can't write WebP). */
export async function toThumbnail(png: Blob): Promise<{ blob: Blob; width: number; height: number }> {
  const bitmap = await createImageBitmap(png);
  const { width, height } = bitmap;
  const canvas = new OffscreenCanvas(width, height);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
  bitmap.close();
  return { blob: await canvas.convertToBlob({ type: "image/webp", quality: 0.82 }), width, height };
}

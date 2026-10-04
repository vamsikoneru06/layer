/**
 * Assets shipped with the app (the sample photos in public/samples) are stored as system-owned public
 * asset rows whose storage key starts with this prefix. They're served by the site itself, so they
 * resolve without object storage.
 */
export const BUNDLED_PREFIX = "bundled/";

export const isBundled = (storageKey: string) => storageKey.startsWith(BUNDLED_PREFIX);

/** "bundled/samples/x.jpg" → "/samples/x.jpg" (a same-origin path under public/). */
export const bundledUrl = (storageKey: string) => `/${storageKey.slice(BUNDLED_PREFIX.length)}`;

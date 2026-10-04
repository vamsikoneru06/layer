/**
 * Sample photos bundled with the app (public/samples, from Pexels; see samples.json for credits).
 * Seed templates fill their frames with them; the database holds them as system-owned public assets
 * whose storage key starts with "bundled/", which the API resolves to the static file.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { AssetRef } from "@vash/schema";
import { BUNDLED_PREFIX } from "../src/server/assets/bundled";

export interface SamplePhoto {
  key: string;
  file: string;
  bytes: number;
  width: number;
  height: number;
  alt: string;
  photographer: string;
  photographerUrl: string;
  pexelsUrl: string;
}

const data = JSON.parse(readFileSync(new URL("./samples.json", import.meta.url), "utf8")) as { samples: SamplePhoto[] };

export const SAMPLE_PHOTOS: ReadonlyMap<string, SamplePhoto> = new Map(data.samples.map((s) => [s.key, s]));

/** A stable UUID per sample (hash-based, RFC 9562 version 8), so reseeding finds the same row. */
export function sampleAssetId(key: string): string {
  const hex = createHash("sha256").update(`vash-sample-photo:${key}`).digest("hex").slice(0, 32).split("");
  hex[12] = "8";
  hex[16] = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  const h = hex.join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function sampleAssetRef(key: string): AssetRef {
  const s = SAMPLE_PHOTOS.get(key);
  if (!s) throw new Error(`unknown sample photo "${key}"`);
  return { id: sampleAssetId(key), kind: "photo", mime: "image/jpeg", width: s.width, height: s.height };
}

/** The asset rows the seed script upserts: system-owned (no owner), public, ready. */
export function sampleAssetRows() {
  return [...SAMPLE_PHOTOS.values()].map((s) => ({
    id: sampleAssetId(s.key),
    ownerId: null,
    kind: "photo" as const,
    visibility: "public" as const,
    status: "ready" as const,
    storageKey: `${BUNDLED_PREFIX}samples/${s.file}`,
    mime: "image/jpeg" as const,
    bytes: s.bytes,
    width: s.width,
    height: s.height,
  }));
}

/**
 * Downloads the sample photos used in seed templates and on the sign-in page from Pexels (free to use
 * under the Pexels License; credit is kept in templates/samples.json and public/samples/CREDITS.txt).
 * Reproducible: rerunning picks the same photos for the same queries while Pexels' results stay the same.
 *
 *   node --env-file=apps/web/.env.local --import tsx apps/web/scripts/fetch-sample-photos.ts
 *
 * Needs PEXELS_API_KEY (free, pexels.com/api). The key is only sent to api.pexels.com.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type Orientation = "portrait" | "landscape" | "square";
interface Want {
  key: string;
  query: string;
  orientation: Orientation;
}

/** Template sample photos: one per subject a template's frames call for. */
const SAMPLES: Want[] = [
  { key: "arch-window", query: "sunlit arch architecture", orientation: "portrait" },
  { key: "birthday-child", query: "child birthday party smiling", orientation: "square" },
  { key: "plated-dish", query: "gourmet plated dish restaurant", orientation: "portrait" },
  { key: "beach-day", query: "beach day friends", orientation: "square" },
  { key: "golden-hour", query: "golden hour field", orientation: "square" },
  { key: "sea-swim", query: "swimming in the sea", orientation: "square" },
  { key: "sneakers", query: "white sneakers", orientation: "portrait" },
  { key: "speaker", query: "woman portrait professional", orientation: "square" },
  { key: "presenter", query: "man smiling portrait", orientation: "portrait" },
  { key: "city-street", query: "city street travel", orientation: "landscape" },
  { key: "pasta-bowl", query: "pasta bowl", orientation: "portrait" },
  { key: "coffee-cup", query: "coffee cup", orientation: "portrait" },
  { key: "tea-cup", query: "cup of tea", orientation: "portrait" },
  { key: "modern-building", query: "modern architecture minimal", orientation: "square" },
  { key: "cafe-interior", query: "cozy cafe interior", orientation: "portrait" },
  { key: "concert", query: "singer concert stage lights", orientation: "square" },
  { key: "flowers-vase", query: "flowers in vase", orientation: "portrait" },
  { key: "wedding-couple", query: "wedding couple", orientation: "portrait" },
  { key: "kid-balloons", query: "girl holding balloons", orientation: "square" },
  { key: "dinner-table", query: "dinner table friends", orientation: "landscape" },
  { key: "family-lights", query: "family celebration lights", orientation: "square" },
  { key: "mountain-lake", query: "mountain lake", orientation: "square" },
  { key: "latte-art", query: "latte art", orientation: "portrait" },
  { key: "fashion-model", query: "fashion model street style", orientation: "portrait" },
  { key: "clothes-rack", query: "clothing rack boutique", orientation: "portrait" },
  { key: "team-office", query: "team working office", orientation: "square" },
  { key: "podcast-mic", query: "podcast microphone", orientation: "portrait" },
  { key: "graduate", query: "graduation cap gown", orientation: "portrait" },
  { key: "couple-sunset", query: "couple sunset", orientation: "square" },
  { key: "workout", query: "workout gym", orientation: "portrait" },
  { key: "books", query: "books reading", orientation: "portrait" },
  { key: "vegetables", query: "fresh vegetables market", orientation: "square" },
  { key: "fruit", query: "fresh fruit", orientation: "square" },
  { key: "road-trip", query: "road trip car", orientation: "landscape" },
  { key: "portrait-bw", query: "black and white portrait", orientation: "portrait" },
  { key: "plants", query: "plants on shelf bright", orientation: "portrait" },
  { key: "sunrise-mountains", query: "sunrise mountains", orientation: "portrait" },
  { key: "baby-toys", query: "baby shower", orientation: "square" },
  { key: "forest-trail", query: "forest trail", orientation: "square" },
  { key: "ocean-waves", query: "ocean waves", orientation: "square" },
  { key: "desert-dunes", query: "desert dunes", orientation: "square" },
  { key: "snowy-peaks", query: "snowy mountain peaks", orientation: "square" },
];

/** More photos for the sign-in page's photo wall (files 10.jpg onwards). */
const STREAM: Want[] = [
  { key: "stream-10", query: "hot air balloons", orientation: "portrait" },
  { key: "stream-11", query: "street food night market", orientation: "portrait" },
  { key: "stream-12", query: "friends laughing outdoors", orientation: "portrait" },
  { key: "stream-13", query: "autumn leaves", orientation: "portrait" },
  { key: "stream-14", query: "surfing", orientation: "portrait" },
  { key: "stream-15", query: "colorful building facade", orientation: "portrait" },
  { key: "stream-16", query: "dog portrait", orientation: "portrait" },
  { key: "stream-17", query: "lanterns festival", orientation: "portrait" },
  { key: "stream-18", query: "rainy city night", orientation: "portrait" },
];

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const samplesDir = join(root, "public", "samples");
const streamDir = join(root, "public", "images", "stream");
const key = process.env.PEXELS_API_KEY;
if (!key) {
  console.error("PEXELS_API_KEY is required (see the header comment).");
  process.exit(1);
}

interface PexelsPhoto {
  id: number;
  width: number;
  height: number;
  url: string;
  alt: string;
  photographer: string;
  photographer_url: string;
  src: { original: string };
}

async function search(w: Want): Promise<PexelsPhoto[]> {
  const params = new URLSearchParams({ query: w.query, orientation: w.orientation, per_page: "15" });
  const res = await fetch(`https://api.pexels.com/v1/search?${params}`, { headers: { Authorization: key! } });
  if (!res.ok) throw new Error(`Pexels search "${w.query}" answered ${res.status}`);
  return ((await res.json()) as { photos: PexelsPhoto[] }).photos;
}

/** Width and height from a JPEG's SOF marker, so the recorded size is the file's real size. */
function jpegSize(buf: Uint8Array): { width: number; height: number } {
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) throw new Error("not a JPEG");
    const marker = buf[i + 1]!;
    const len = (buf[i + 2]! << 8) | buf[i + 3]!;
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: (buf[i + 5]! << 8) | buf[i + 6]!, width: (buf[i + 7]! << 8) | buf[i + 8]! };
    }
    i += 2 + len;
  }
  throw new Error("no JPEG size");
}

async function download(photo: PexelsPhoto, longSide: number, file: string) {
  const size = photo.width >= photo.height ? `w=${longSide}` : `h=${longSide}`;
  const res = await fetch(`${photo.src.original}?auto=compress&cs=tinysrgb&fm=jpg&${size}`);
  if (!res.ok) throw new Error(`download ${photo.id} answered ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  writeFileSync(file, buf);
  return { bytes: buf.length, ...jpegSize(buf) };
}

mkdirSync(samplesDir, { recursive: true });
const used = new Set<number>();
const credits: string[] = [];

async function fetchAll(list: Want[], dir: string, name: (w: Want) => string, longSide: number) {
  const out = [];
  for (const w of list) {
    const photo = (await search(w)).find((p) => !used.has(p.id));
    if (!photo) throw new Error(`no unused result for "${w.query}"`);
    used.add(photo.id);
    const file = name(w);
    const meta = await download(photo, longSide, join(dir, file));
    out.push({ key: w.key, file, ...meta, alt: photo.alt, photographer: photo.photographer, photographerUrl: photo.photographer_url, pexelsUrl: photo.url });
    credits.push(`${file}: "${photo.alt || w.query}" by ${photo.photographer} (${photo.photographer_url}), ${photo.url}`);
    console.log(`${file}  ${meta.width}x${meta.height}  ${(meta.bytes / 1024).toFixed(0)} KB  by ${photo.photographer}`);
  }
  return out;
}

const samples = await fetchAll(SAMPLES, samplesDir, (w) => `${w.key}.jpg`, 1400);
const stream = await fetchAll(STREAM, streamDir, (w) => `${w.key.replace("stream-", "")}.jpg`, 900);

writeFileSync(join(root, "templates", "samples.json"), `${JSON.stringify({ source: "Pexels (pexels.com), Pexels License", samples, stream }, null, 2)}\n`);
writeFileSync(
  join(samplesDir, "CREDITS.txt"),
  `Photos from Pexels (https://www.pexels.com), used under the Pexels License (https://www.pexels.com/license/).\n\n${credits.join("\n")}\n`,
);
console.log(`${samples.length} sample photos, ${stream.length} sign-in photos`);

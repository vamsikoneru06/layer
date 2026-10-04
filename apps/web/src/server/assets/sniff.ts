export type SniffedMime = "image/jpeg" | "image/png" | "image/webp";

/** How many leading bytes `sniffImageMime` needs (WebP's marker ends at byte 12). */
export const SNIFF_BYTES = 16;

const JPEG = [0xff, 0xd8, 0xff];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const RIFF = [0x52, 0x49, 0x46, 0x46];
const WEBP = [0x57, 0x45, 0x42, 0x50];

const has = (bytes: Uint8Array, signature: number[], at = 0) => signature.every((value, i) => bytes[at + i] === value);

/** The image type a file's leading bytes prove, or null. Never trust the declared MIME or the extension. */
export function sniffImageMime(bytes: Uint8Array): SniffedMime | null {
  if (has(bytes, JPEG)) return "image/jpeg";
  if (has(bytes, PNG)) return "image/png";
  if (has(bytes, RIFF) && has(bytes, WEBP, 8)) return "image/webp";
  return null;
}

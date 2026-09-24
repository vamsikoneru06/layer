import type { FormatKey } from "./types";

export const CURRENT_SCHEMA_VERSION = 1 as const;

export const LIMITS = {
  designNodes: 500,
  templateNodes: 150,
  docBytes: 1_000_000,
  artboardMin: 16,
  artboardMax: 8192,
  textChars: 5_000,
  titleChars: 120,
  nameChars: 80,
  tags: 10,
  tagChars: 32,
  pathChars: 20_000,
  gradientStops: 8,
  assets: 200,
  coordinate: 100_000,
  rotation: 3_600,
  scaleMin: 0.01,
  scaleMax: 100,
  fontSizeMin: 1,
  fontSizeMax: 2_000,
  polygonSidesMin: 3,
  polygonSidesMax: 64,
  strokeWidthMax: 500,
} as const;

export const FORMATS: Record<Exclude<FormatKey, "custom">, { width: number; height: number; label: string }> = {
  "ig-post": { width: 1080, height: 1080, label: "Instagram post" },
  "ig-story": { width: 1080, height: 1920, label: "Instagram story" },
  "yt-thumbnail": { width: 1280, height: 720, label: "YouTube thumbnail" },
  poster: { width: 1240, height: 1754, label: "Poster" },
  invitation: { width: 1500, height: 2100, label: "Invitation" },
};

export const FORMAT_KEYS: readonly FormatKey[] = [...(Object.keys(FORMATS) as FormatKey[]), "custom"];

/** Google Fonts families users may pick. Anything else is rejected by the validator. */
export const FONT_FAMILIES: readonly string[] = [
  "Inter",
  "Roboto",
  "Open Sans",
  "Poppins",
  "Montserrat",
  "Space Grotesk",
  "Bricolage Grotesque",
  "Archivo Black",
  "Oswald",
  "Bebas Neue",
  "Playfair Display",
  "DM Serif Display",
  "Abril Fatface",
  "Lora",
  "Pacifico",
  "Caveat",
  "Dancing Script",
  "Noto Sans",
  "Noto Sans Devanagari",
  "Noto Sans Telugu",
];

export const CATEGORIES: readonly string[] = [
  "birthday",
  "business",
  "food",
  "travel",
  "quotes",
  "events",
  "sale",
  "minimal",
];

/** Object keys that must never be used as IDs (prototype-pollution guard). */
export const RESERVED_KEYS: ReadonlySet<string> = new Set(["__proto__", "prototype", "constructor"]);

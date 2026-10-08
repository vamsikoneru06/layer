import type { FormatKey } from "./types";

export const CURRENT_SCHEMA_VERSION = 2 as const;

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

/** Templates are filed by the job they do, grouped by who does it (docs/roadmap.md, M2). Ids are stored; labels are shown. */
export const CATEGORY_GROUPS: readonly { label: string; categories: readonly { id: string; label: string }[] }[] = [
  {
    label: "Businesses",
    categories: [
      { id: "menus", label: "Menus and specials" },
      { id: "sales", label: "Sales and new stock" },
      { id: "announcements", label: "Announcements" },
    ],
  },
  {
    label: "Events",
    categories: [
      { id: "events", label: "Event posters" },
      { id: "invitations", label: "Invitations" },
    ],
  },
  {
    label: "Creators",
    categories: [
      { id: "thumbnails", label: "Video thumbnails" },
      { id: "quotes-tips", label: "Quotes and tips" },
    ],
  },
  {
    label: "Personal",
    categories: [
      { id: "celebrations", label: "Celebrations" },
      { id: "photo-posts", label: "Photo posts and recaps" },
    ],
  },
];

export const CATEGORIES: readonly string[] = CATEGORY_GROUPS.flatMap((g) => g.categories.map((c) => c.id));

const LABELS = new Map(CATEGORY_GROUPS.flatMap((g) => g.categories.map((c) => [c.id, c.label] as const)));
export const categoryLabel = (id: string): string => LABELS.get(id) ?? id;

/** Object keys that must never be used as IDs (prototype-pollution guard). */
export const RESERVED_KEYS: ReadonlySet<string> = new Set(["__proto__", "prototype", "constructor"]);

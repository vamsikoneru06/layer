/**
 * The seed templates, authored in code until Author Mode exists (spec §8.3). Photo frames start
 * with bundled sample photos (templates/samples.ts) that users replace with their own.
 * Original designs; style cues only from current editorial / social trends — no copied artwork.
 * `pnpm --filter @vash/web templates:build` writes them to templates/seed/*.json.
 */
import { defaultFilters, FORMATS, type AssetRef, type Doc, type Fill, type FormatKey, type FrameNode, type Lock, type Node, type ShapeNode, type TextNode } from "@vash/schema";
import { presetFilters } from "@vash/engine";
import { sampleAssetRef } from "./samples";

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
  opacity?: number;
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Boxes are authored by top-left corner; the format stores the centre. */
function base(id: string, name: string, b: Box, lock: Lock) {
  return {
    id,
    name,
    transform: { x: round(b.x + b.w / 2), y: round(b.y + b.h / 2), rotation: b.rotation ?? 0, scaleX: 1, scaleY: 1 },
    width: b.w,
    height: b.h,
    opacity: b.opacity ?? 1,
    visible: true,
    lock,
  };
}

const solid = (color: string): Fill => ({ type: "solid", color });
const linear = (angle: number, ...colors: string[]): Fill => ({
  type: "linear",
  angle,
  stops: colors.map((color, i) => ({ offset: round(i / (colors.length - 1)), color })),
});

/** Unit-box arch: straight sides, semicircular top. */
const ARCH = "M0 1 L0 0.5 A0.5 0.5 0 0 1 1 0.5 L1 1 Z";

function photo(id: string, name: string, b: Box, shape: "rect" | "ellipse" | "arch" = "rect", radius = 0): FrameNode {
  return {
    ...base(id, name, b, "content-only"),
    type: "frame",
    shape: shape === "arch" ? { kind: "path", d: ARCH } : shape === "ellipse" ? { kind: "ellipse" } : { kind: "rect", cornerRadius: radius },
    content: null,
    filters: defaultFilters(),
    placeholder: true,
  };
}

interface TextStyle {
  family: string;
  weight?: number;
  italic?: boolean;
  size: number;
  color: string;
  align?: TextNode["align"];
  lineHeight?: number;
  letterSpacing?: number;
  maxChars?: number;
}

function text(id: string, name: string, content: string, b: Box, s: TextStyle): TextNode {
  return {
    ...base(id, name, b, "content-only"),
    type: "text",
    content,
    font: { family: s.family, weight: s.weight ?? 400, style: s.italic ? "italic" : "normal" },
    size: s.size,
    color: s.color,
    align: s.align ?? "left",
    lineHeight: s.lineHeight ?? 1.2,
    letterSpacing: s.letterSpacing ?? 0,
    fit: "shrink",
    maxChars: s.maxChars ?? Math.max(24, content.length * 2),
  };
}

type ShapeOpts = { radius?: number; stroke?: { color: string; width: number } };

function shape(id: string, name: string, b: Box, geometry: ShapeNode["geometry"], fill: Fill | null, stroke: ShapeOpts["stroke"] = undefined): ShapeNode {
  return { ...base(id, name, b, "locked"), type: "shape", geometry, fill, stroke: stroke ?? null };
}
const rect = (id: string, name: string, b: Box, fill: Fill | null, o: ShapeOpts = {}) =>
  shape(id, name, b, { kind: "rect", cornerRadius: o.radius ?? 0 }, fill, o.stroke);
const ellipse = (id: string, name: string, b: Box, fill: Fill | null, o: ShapeOpts = {}) => shape(id, name, b, { kind: "ellipse" }, fill, o.stroke);
const polygon = (id: string, name: string, b: Box, sides: number, fill: Fill | null) => shape(id, name, b, { kind: "polygon", sides }, fill);

/**
 * A rotated polaroid: white card, photo inset near the top, handwritten caption below.
 * Each layer rotates about its own centre, so the inner centres are rotated about the card's.
 */
function polaroid(prefix: string, cx: number, cy: number, rotation: number, caption: string): Node[] {
  const w = 520;
  const h = 600;
  const inset = 30;
  const photoSize = w - inset * 2;
  const rad = (rotation * Math.PI) / 180;
  const place = (dy: number) => ({ x: cx - dy * Math.sin(rad), y: cy + dy * Math.cos(rad) });
  const photoCentre = place(-h / 2 + inset + photoSize / 2);
  const captionCentre = place(h / 2 - 55);
  return [
    rect(`${prefix}-card`, "Polaroid card", { x: cx - w / 2, y: cy - h / 2, w, h, rotation }, solid("#FFFFFF")),
    photo(`${prefix}-photo`, "Photo", { x: photoCentre.x - photoSize / 2, y: photoCentre.y - photoSize / 2, w: photoSize, h: photoSize, rotation }),
    text(`${prefix}-caption`, "Caption", caption, { x: captionCentre.x - 220, y: captionCentre.y - 30, w: 440, h: 60, rotation }, {
      family: "Caveat",
      weight: 700,
      size: 48,
      color: "#2B2B2B",
      align: "center",
      maxChars: 24,
    }),
  ];
}

/** A photo frame that starts with one of the engine's filter presets (film grain, faded, black and white...). */
function filmed(frame: FrameNode, preset: string): FrameNode {
  return { ...frame, filters: presetFilters(preset) };
}

/** A column of film-strip sprocket holes as one path, filled in the colour behind the strip. */
function sprockets(id: string, b: Box, color: string): ShapeNode {
  const hole = 24 / b.h;
  const gap = 64 / b.h;
  const parts: string[] = [];
  for (let y = 0; y + hole <= 1; y += gap) {
    const top = Math.round(y * 1000) / 1000;
    const bottom = Math.round((y + hole) * 1000) / 1000;
    parts.push(`M0 ${top} L1 ${top} L1 ${bottom} L0 ${bottom} Z`);
  }
  return shape(id, "Sprocket holes", b, { kind: "path", d: parts.join(" ") }, solid(color));
}

/** A row of colour swatches (circles) for moodboards. */
function swatches(prefix: string, x: number, y: number, size: number, step: number, colors: string[]): Node[] {
  return colors.map((color, i) => ellipse(`${prefix}-${i + 1}`, "Colour swatch", { x: x + i * step, y, w: size, h: size }, solid(color)));
}

/** One numbered step of a how-to list: a circle with the number, a short title and one line under it. */
function howToStep(n: number, y: number, title: string, body: string): Node[] {
  return [
    ellipse(`step${n}-dot`, "Step circle", { x: 90, y, w: 110, h: 110 }, solid("#F59E0B")),
    text(`step${n}-number`, "Step number", String(n), { x: 90, y: y + 28, w: 110, h: 54 }, { family: "Archivo Black", size: 44, color: "#2A1F14", align: "center", maxChars: 3 }),
    text(`step${n}-title`, "Step title", title, { x: 240, y: y + 4, w: 750, h: 58 }, { family: "Inter", weight: 700, size: 40, color: "#2A1F14", maxChars: 48 }),
    text(`step${n}-body`, "Step text", body, { x: 240, y: y + 70, w: 750, h: 110 }, { family: "Inter", size: 30, lineHeight: 1.4, color: "#6B5A48", maxChars: 90 }),
  ];
}

interface Definition {
  id: string;
  title: string;
  format: Exclude<FormatKey, "custom">;
  category: string;
  tags: string[];
  background: Fill;
  nodes: Node[];
  /** Sample photo keys (templates/samples.json), one per photo frame in the order they appear. */
  photos?: string[];
}

function template(d: Definition): Doc {
  const size = FORMATS[d.format];
  const frames = d.nodes.filter((n): n is FrameNode => n.type === "frame");
  const photos = d.photos ?? [];
  if (photos.length !== frames.length) throw new Error(`${d.id}: ${frames.length} photo frames but ${photos.length} sample photos`);
  const assets: Record<string, AssetRef> = {};
  const nodes = d.nodes.map((n) => {
    if (n.type !== "frame") return n;
    const ref = sampleAssetRef(photos[frames.indexOf(n)]!);
    assets[ref.id] = ref;
    return { ...n, content: { assetId: ref.id, offsetX: 0, offsetY: 0, scale: 1 } };
  });
  return {
    schemaVersion: 2,
    id: d.id,
    kind: "template",
    meta: { title: d.title, category: d.category, tags: d.tags, format: d.format },
    artboard: { width: size.width, height: size.height, background: d.background },
    root: nodes.map((n) => n.id),
    nodes: Object.fromEntries(nodes.map((n) => [n.id, n])),
    assets,
  };
}

const RUST = "#BC361B";

export function seedTemplates(): Doc[] {
  return [
    // ── Instagram post (1080 × 1080) ─────────────────────────────────────────
    template({
      id: "post-editorial-bloom",
      photos: ["arch-window"],
      title: "Editorial Bloom",
      format: "ig-post",
      category: "photo-posts",
      tags: ["editorial", "arch", "neutral", "spring"],
      background: solid("#F4F1EC"),
      nodes: [
        photo("photo", "Arch photo", { x: 90, y: 150, w: 440, h: 700 }, "arch"),
        rect("accent", "Accent line", { x: 590, y: 240, w: 80, h: 6 }, solid(RUST)),
        text("eyebrow", "Eyebrow", "VOL. 04 · SPRING EDIT", { x: 590, y: 270, w: 400, h: 40 }, { family: "Inter", weight: 600, size: 22, letterSpacing: 4, color: "#6B6259", maxChars: 40 }),
        text("headline", "Headline", "Slow mornings, soft light", { x: 590, y: 330, w: 420, h: 330 }, { family: "DM Serif Display", size: 76, lineHeight: 1.05, color: "#1E1B18", maxChars: 60 }),
        text("body", "Body", "A small collection of quiet places and the people who make them feel like home.", { x: 590, y: 690, w: 390, h: 120 }, { family: "Inter", size: 24, lineHeight: 1.4, color: "#4A433C", maxChars: 160 }),
        text("handle", "Handle", "@yourstudio", { x: 590, y: 890, w: 300, h: 36 }, { family: "Inter", weight: 500, size: 20, color: RUST }),
      ],
    }),
    template({
      id: "post-confetti-birthday",
      photos: ["birthday-child"],
      title: "Confetti Birthday",
      format: "ig-post",
      category: "celebrations",
      tags: ["birthday", "confetti", "pastel", "party"],
      background: linear(135, "#FFD6E0", "#FFE9C7"),
      nodes: [
        ellipse("confetti-1", "Confetti", { x: 110, y: 120, w: 36, h: 36 }, solid("#FF7AA2")),
        polygon("confetti-2", "Confetti", { x: 900, y: 150, w: 44, h: 44, rotation: 20 }, 3, solid("#6C63FF")),
        rect("confetti-3", "Confetti", { x: 180, y: 880, w: 24, h: 60, rotation: -30 }, solid("#FFB020"), { radius: 12 }),
        ellipse("confetti-4", "Confetti", { x: 930, y: 860, w: 28, h: 28 }, solid("#3DD6B5")),
        polygon("confetti-5", "Confetti", { x: 850, y: 520, w: 30, h: 30, opacity: 0.8 }, 6, solid("#FF7AA2")),
        ellipse("confetti-6", "Confetti", { x: 70, y: 560, w: 22, h: 22 }, solid("#6C63FF")),
        ellipse("ring", "Photo ring", { x: 330, y: 150, w: 420, h: 420 }, solid("#FFFFFF")),
        photo("photo", "Birthday photo", { x: 350, y: 170, w: 380, h: 380 }, "ellipse"),
        text("title", "Title", "Happy Birthday", { x: 90, y: 600, w: 900, h: 150 }, { family: "Pacifico", size: 92, color: "#E23E70", align: "center", maxChars: 24 }),
        text("name", "Name", "Maya turns 25", { x: 140, y: 760, w: 800, h: 64 }, { family: "Poppins", weight: 600, size: 44, color: "#3B2F5B", align: "center", maxChars: 32 }),
        text("details", "Details", "Saturday · 7 PM · Rooftop", { x: 140, y: 840, w: 800, h: 44 }, { family: "Poppins", weight: 500, size: 28, color: "#6B5B7B", align: "center", maxChars: 48 }),
      ],
    }),
    template({
      id: "post-chefs-special",
      photos: ["plated-dish"],
      title: "Chef's Special",
      format: "ig-post",
      category: "menus",
      tags: ["menu", "restaurant", "dark", "special"],
      background: solid("#1F3A2E"),
      nodes: [
        photo("photo", "Dish photo", { x: 60, y: 60, w: 620, h: 960 }, "rect", 32),
        text("eyebrow", "Eyebrow", "CHEF'S SPECIAL", { x: 720, y: 110, w: 320, h: 36 }, { family: "Inter", weight: 700, size: 22, letterSpacing: 6, color: "#E9C46A" }),
        text("dish", "Dish name", "Roasted tomato & basil pasta", { x: 720, y: 170, w: 320, h: 330 }, { family: "Playfair Display", weight: 700, size: 58, lineHeight: 1.1, color: "#F7F3E8", maxChars: 60 }),
        rect("divider", "Divider", { x: 720, y: 530, w: 60, h: 4 }, solid("#E9C46A")),
        text("description", "Description", "Slow-roasted tomatoes, garden basil, parmesan and a squeeze of lemon.", { x: 720, y: 560, w: 320, h: 170 }, { family: "Inter", size: 22, lineHeight: 1.45, color: "#CFD8CF", maxChars: 140 }),
        ellipse("badge", "Price badge", { x: 780, y: 790, w: 200, h: 200 }, solid("#E9C46A")),
        text("price", "Price", "₹249", { x: 780, y: 855, w: 200, h: 70 }, { family: "Archivo Black", size: 54, color: "#1F3A2E", align: "center", maxChars: 8 }),
      ],
    }),
    template({
      id: "post-loud-quote",
      title: "Loud Quote",
      format: "ig-post",
      category: "quotes-tips",
      tags: ["quote", "bold", "typography", "motivation"],
      background: solid("#111111"),
      nodes: [
        text("mark", "Quote mark", "“", { x: 80, y: 40, w: 200, h: 260 }, { family: "DM Serif Display", size: 260, color: "#F2C94C", maxChars: 2 }),
        text("quote", "Quote", "DONE IS BETTER THAN PERFECT", { x: 80, y: 290, w: 920, h: 450 }, { family: "Bebas Neue", size: 150, lineHeight: 0.95, color: "#F2C94C", maxChars: 60 }),
        rect("line", "Line", { x: 80, y: 800, w: 120, h: 6 }, solid("#F2C94C")),
        text("attribution", "Attribution", "Notes to self", { x: 80, y: 830, w: 700, h: 44 }, { family: "Inter", weight: 500, size: 30, color: "#BDBDBD", maxChars: 40 }),
        text("handle", "Handle", "@yourhandle", { x: 680, y: 960, w: 320, h: 36 }, { family: "Inter", weight: 500, size: 24, color: "#7A7A7A", align: "right" }),
      ],
    }),

    // ── Instagram story (1080 × 1920) ────────────────────────────────────────
    template({
      id: "story-weekend-dump",
      photos: ["beach-day", "golden-hour", "sea-swim"],
      title: "Weekend Photo Dump",
      format: "ig-story",
      category: "photo-posts",
      tags: ["photo dump", "polaroid", "collage", "weekend"],
      background: solid("#EDE6DA"),
      nodes: [
        text("title", "Title", "weekend dump", { x: 90, y: 110, w: 900, h: 140 }, { family: "Caveat", weight: 700, size: 110, color: "#2B2B2B", align: "center", maxChars: 30 }),
        ...polaroid("p1", 400, 640, -6, "day one"),
        ...polaroid("p2", 700, 1100, 5, "golden hour"),
        ...polaroid("p3", 430, 1480, -3, "last swim"),
        text("dates", "Dates", "JUNE 14–16", { x: 290, y: 1800, w: 500, h: 44 }, { family: "Inter", weight: 700, size: 30, letterSpacing: 6, color: "#2B2B2B", align: "center" }),
      ],
    }),
    template({
      id: "story-flash-sale",
      photos: ["sneakers"],
      title: "Flash Sale Drop",
      format: "ig-story",
      category: "sales",
      tags: ["sale", "discount", "gradient", "shop"],
      background: linear(160, "#FF5A36", "#FFB020"),
      nodes: [
        text("eyebrow", "Eyebrow", "NEW DROP · 48 HOURS ONLY", { x: 90, y: 160, w: 900, h: 44 }, { family: "Inter", weight: 700, size: 30, letterSpacing: 5, color: "#FFFFFF", align: "center", maxChars: 40 }),
        text("offer", "Offer", "50% OFF", { x: 60, y: 240, w: 960, h: 220 }, { family: "Archivo Black", size: 190, lineHeight: 0.95, color: "#FFFFFF", align: "center", maxChars: 12 }),
        photo("photo", "Product photo", { x: 140, y: 540, w: 800, h: 900 }, "rect", 48),
        polygon("burst", "Burst", { x: 760, y: 470, w: 240, h: 240, rotation: 12 }, 12, solid("#FFE14D")),
        text("burst-label", "Burst label", "EVERYTHING", { x: 760, y: 565, w: 240, h: 50, rotation: 12 }, { family: "Archivo Black", size: 26, color: "#1A1A1A", align: "center", maxChars: 12 }),
        rect("cta-pill", "Button", { x: 290, y: 1560, w: 500, h: 120 }, solid("#FFFFFF"), { radius: 60 }),
        text("cta", "Button label", "Shop the sale", { x: 290, y: 1590, w: 500, h: 60 }, { family: "Poppins", weight: 700, size: 44, color: "#E0431F", align: "center", maxChars: 20 }),
        text("hint", "Hint", "Link in bio", { x: 290, y: 1730, w: 500, h: 40 }, { family: "Inter", weight: 500, size: 28, color: "#FFF1E0", align: "center" }),
      ],
    }),
    template({
      id: "story-countdown",
      photos: ["speaker"],
      title: "Event Countdown",
      format: "ig-story",
      category: "events",
      tags: ["countdown", "event", "dark", "meetup"],
      background: solid("#0E0E12"),
      nodes: [
        ellipse("ring", "Ring", { x: 270, y: 200, w: 540, h: 540 }, null, { stroke: { color: "#FF5A36", width: 6 } }),
        photo("photo", "Speaker photo", { x: 290, y: 220, w: 500, h: 500 }, "ellipse"),
        text("days", "Days left", "03", { x: 140, y: 780, w: 800, h: 420 }, { family: "Bebas Neue", size: 420, lineHeight: 1, color: "#FF5A36", align: "center", maxChars: 3 }),
        text("label", "Label", "days to go", { x: 140, y: 1200, w: 800, h: 80 }, { family: "Space Grotesk", weight: 500, size: 64, color: "#FFFFFF", align: "center" }),
        rect("divider", "Divider", { x: 490, y: 1330, w: 100, h: 4 }, solid("#FF5A36")),
        text("event", "Event name", "Indie Makers Meetup", { x: 90, y: 1380, w: 900, h: 140 }, { family: "Space Grotesk", weight: 700, size: 56, lineHeight: 1.1, color: "#FFFFFF", align: "center", maxChars: 40 }),
        text("details", "Details", "Sat 12 Oct · Hyderabad", { x: 90, y: 1540, w: 900, h: 50 }, { family: "Inter", weight: 500, size: 34, color: "#A0A0AA", align: "center" }),
      ],
    }),
    template({
      id: "story-soft-quote",
      title: "Soft Gradient Quote",
      format: "ig-story",
      category: "quotes-tips",
      tags: ["quote", "pastel", "gradient", "self-care"],
      background: linear(180, "#FDE2E4", "#CDE7F0"),
      nodes: [
        ellipse("blob-1", "Blob", { x: -120, y: 180, w: 520, h: 520, opacity: 0.35 }, solid("#FFFFFF")),
        ellipse("blob-2", "Blob", { x: 700, y: 1350, w: 500, h: 500, opacity: 0.35 }, solid("#FFFFFF")),
        text("quote", "Quote", "Be gentle with yourself. You’re growing.", { x: 110, y: 640, w: 860, h: 520 }, { family: "Lora", italic: true, size: 88, lineHeight: 1.25, color: "#2E2A3B", align: "center", maxChars: 90 }),
        rect("line", "Line", { x: 490, y: 1220, w: 100, h: 3, opacity: 0.5 }, solid("#2E2A3B")),
        text("note", "Note", "a note for today", { x: 190, y: 1260, w: 700, h: 50 }, { family: "Inter", weight: 500, size: 32, letterSpacing: 3, color: "#5A5470", align: "center" }),
        text("handle", "Handle", "@yourhandle", { x: 290, y: 1760, w: 500, h: 40 }, { family: "Inter", weight: 500, size: 28, color: "#5A5470", align: "center" }),
      ],
    }),

    // ── YouTube thumbnail (1280 × 720) ───────────────────────────────────────
    template({
      id: "thumb-three-tips",
      photos: ["presenter"],
      title: "Three Tips",
      format: "yt-thumbnail",
      category: "thumbnails",
      tags: ["youtube", "tips", "productivity", "bold"],
      background: solid("#F5F5F0"),
      nodes: [
        photo("photo", "Presenter photo", { x: 0, y: 0, w: 600, h: 720 }),
        rect("highlight", "Highlight", { x: 648, y: 150, w: 560, h: 90 }, solid("#FFE14D")),
        text("number", "Headline", "3 TIPS", { x: 660, y: 90, w: 580, h: 170 }, { family: "Archivo Black", size: 110, color: "#111111", maxChars: 10 }),
        text("subject", "Subject", "to double your focus", { x: 660, y: 300, w: 580, h: 220 }, { family: "Montserrat", weight: 800, size: 64, lineHeight: 1.05, color: "#111111", maxChars: 40 }),
        rect("badge", "Badge", { x: 660, y: 560, w: 260, h: 70 }, solid("#111111"), { radius: 35 }),
        text("badge-label", "Badge label", "NEW VIDEO", { x: 660, y: 578, w: 260, h: 34 }, { family: "Inter", weight: 800, size: 28, letterSpacing: 3, color: "#FFFFFF", align: "center", maxChars: 14 }),
      ],
    }),
    template({
      id: "thumb-48-hours",
      photos: ["city-street"],
      title: "48 Hours In",
      format: "yt-thumbnail",
      category: "thumbnails",
      tags: ["vlog", "travel", "youtube", "beach"],
      background: solid("#000000"),
      nodes: [
        photo("photo", "Destination photo", { x: 0, y: 0, w: 1280, h: 720 }),
        rect("shade", "Shade", { x: 0, y: 0, w: 760, h: 720 }, linear(90, "#000000CC", "#00000000")),
        text("kicker", "Kicker", "48 HOURS IN", { x: 70, y: 180, w: 640, h: 70 }, { family: "Montserrat", weight: 800, size: 56, letterSpacing: 4, color: "#FFFFFF", maxChars: 20 }),
        text("place", "Place", "GOA", { x: 60, y: 240, w: 640, h: 300 }, { family: "Bebas Neue", size: 300, lineHeight: 0.9, color: "#FFD23F", maxChars: 12 }),
        text("topics", "Topics", "beaches · food · hidden spots", { x: 70, y: 560, w: 640, h: 44 }, { family: "Inter", weight: 600, size: 32, color: "#FFFFFF", maxChars: 40 }),
      ],
    }),
    template({
      id: "thumb-quick-recipe",
      photos: ["pasta-bowl"],
      title: "Quick Recipe",
      format: "yt-thumbnail",
      category: "thumbnails",
      tags: ["recipe", "cooking", "youtube", "warm"],
      background: solid("#FFF4E0"),
      nodes: [
        ellipse("blob", "Blob", { x: -80, y: 420, w: 380, h: 380, opacity: 0.5 }, solid("#FFB347")),
        photo("photo", "Dish photo", { x: 620, y: 0, w: 660, h: 720 }),
        text("time", "Time", "15-min", { x: 70, y: 110, w: 520, h: 110 }, { family: "Caveat", weight: 700, size: 96, color: "#E0602F", maxChars: 12 }),
        text("dish", "Dish", "Creamy Garlic Pasta", { x: 70, y: 220, w: 520, h: 300 }, { family: "Playfair Display", weight: 800, size: 96, lineHeight: 1, color: "#2A1E14", maxChars: 30 }),
        text("note", "Note", "one pan · 5 ingredients", { x: 70, y: 560, w: 520, h: 44 }, { family: "Inter", weight: 600, size: 30, color: "#6A5646", maxChars: 36 }),
      ],
    }),
    template({
      id: "thumb-versus",
      photos: ["coffee-cup", "tea-cup"],
      title: "Head to Head",
      format: "yt-thumbnail",
      category: "thumbnails",
      tags: ["comparison", "versus", "review", "youtube"],
      background: solid("#111827"),
      nodes: [
        photo("left", "Left photo", { x: 40, y: 40, w: 580, h: 640 }, "rect", 24),
        photo("right", "Right photo", { x: 660, y: 40, w: 580, h: 640 }, "rect", 24),
        ellipse("vs-circle", "VS circle", { x: 530, y: 250, w: 220, h: 220 }, solid("#EF4444"), { stroke: { color: "#FFFFFF", width: 8 } }),
        text("vs", "VS", "VS", { x: 530, y: 305, w: 220, h: 110 }, { family: "Archivo Black", size: 96, color: "#FFFFFF", align: "center", maxChars: 4 }),
        rect("label-left-bg", "Label", { x: 70, y: 580, w: 260, h: 70 }, solid("#FFFFFF"), { radius: 12 }),
        text("label-left", "Left label", "OPTION A", { x: 70, y: 597, w: 260, h: 36 }, { family: "Montserrat", weight: 800, size: 30, color: "#111827", align: "center", maxChars: 14 }),
        rect("label-right-bg", "Label", { x: 950, y: 580, w: 260, h: 70 }, solid("#FFFFFF"), { radius: 12 }),
        text("label-right", "Right label", "OPTION B", { x: 950, y: 597, w: 260, h: 36 }, { family: "Montserrat", weight: 800, size: 30, color: "#111827", align: "center", maxChars: 14 }),
      ],
    }),

    // ── Poster (1240 × 1754) ─────────────────────────────────────────────────
    template({
      id: "poster-design-week",
      photos: ["modern-building"],
      title: "Design Week",
      format: "poster",
      category: "events",
      tags: ["swiss", "poster", "design", "exhibition"],
      background: solid("#F2F0EA"),
      nodes: [
        ellipse("sun", "Red circle", { x: 520, y: 140, w: 900, h: 900 }, solid("#E63322")),
        photo("photo", "Photo", { x: 90, y: 700, w: 620, h: 620 }),
        text("title-1", "Title", "DESIGN", { x: 90, y: 110, w: 800, h: 190 }, { family: "Space Grotesk", weight: 700, size: 200, lineHeight: 0.9, letterSpacing: -6, color: "#111111", maxChars: 12 }),
        text("title-2", "Title", "WEEK", { x: 90, y: 300, w: 800, h: 190 }, { family: "Space Grotesk", weight: 700, size: 200, lineHeight: 0.9, letterSpacing: -6, color: "#111111", maxChars: 12 }),
        text("dates", "Dates", "OCT 14–18", { x: 760, y: 1120, w: 400, h: 80 }, { family: "Space Grotesk", weight: 700, size: 64, color: "#111111", maxChars: 16 }),
        text("blurb", "Blurb", "Talks, workshops and open studios across the city.", { x: 760, y: 1220, w: 400, h: 170 }, { family: "Inter", weight: 500, size: 30, lineHeight: 1.4, color: "#333333", maxChars: 120 }),
        rect("band", "Band", { x: 0, y: 1604, w: 1240, h: 150 }, solid("#111111")),
        text("footer", "Footer", "Free entry · Register online", { x: 90, y: 1655, w: 1060, h: 50 }, { family: "Space Grotesk", weight: 600, size: 40, color: "#F2F0EA", maxChars: 60 }),
      ],
    }),
    template({
      id: "poster-now-open",
      photos: ["cafe-interior"],
      title: "Now Open",
      format: "poster",
      category: "announcements",
      tags: ["cafe", "opening", "arch", "warm"],
      background: solid("#F7EFE5"),
      nodes: [
        text("kicker", "Kicker", "NOW OPEN", { x: 170, y: 120, w: 900, h: 50 }, { family: "Inter", weight: 700, size: 34, letterSpacing: 10, color: "#8C5A3C", align: "center" }),
        photo("photo", "Arch photo", { x: 270, y: 220, w: 700, h: 880 }, "arch"),
        text("name", "Business name", "Little Fig Café", { x: 70, y: 1150, w: 1100, h: 150 }, { family: "DM Serif Display", size: 120, color: "#2F2A26", align: "center", maxChars: 30 }),
        text("when", "When", "Grand opening · Saturday, 9 AM", { x: 120, y: 1320, w: 1000, h: 60 }, { family: "Inter", weight: 500, size: 40, color: "#5A4A3F", align: "center", maxChars: 50 }),
        text("offer", "Offer", "First coffee on us", { x: 220, y: 1420, w: 800, h: 100, rotation: -3 }, { family: "Caveat", weight: 700, size: 72, color: "#C0613B", align: "center", maxChars: 30 }),
        text("where", "Where", "12 Lake View Road", { x: 220, y: 1600, w: 800, h: 44 }, { family: "Inter", weight: 500, size: 30, color: "#8C5A3C", align: "center", maxChars: 50 }),
      ],
    }),
    template({
      id: "poster-midnight-gig",
      photos: ["concert"],
      title: "Midnight Gig",
      format: "poster",
      category: "events",
      tags: ["music", "concert", "night", "gig"],
      background: linear(180, "#1B0B3A", "#07030F"),
      nodes: [
        ellipse("glow", "Glow", { x: 120, y: 180, w: 1000, h: 1000, opacity: 0.35 }, solid("#7B2FF7")),
        text("kicker", "Kicker", "LIVE TONIGHT", { x: 170, y: 150, w: 900, h: 50 }, { family: "Inter", weight: 700, size: 36, letterSpacing: 12, color: "#C9B6FF", align: "center" }),
        photo("photo", "Artist photo", { x: 270, y: 330, w: 700, h: 700 }, "ellipse"),
        text("title", "Title", "MIDNIGHT FREQUENCIES", { x: 70, y: 1080, w: 1100, h: 300 }, { family: "Bebas Neue", size: 150, lineHeight: 0.95, color: "#FFFFFF", align: "center", maxChars: 30 }),
        text("lineup", "Lineup", "Aria · The Low Tides · DJ Kavi", { x: 70, y: 1400, w: 1100, h: 60 }, { family: "Space Grotesk", weight: 500, size: 40, color: "#E4DBFF", align: "center", maxChars: 60 }),
        text("details", "Details", "Fri 8 PM · Warehouse 9 · Tickets at the door", { x: 70, y: 1600, w: 1100, h: 44 }, { family: "Inter", weight: 500, size: 30, color: "#A99BD6", align: "center", maxChars: 70 }),
      ],
    }),
    template({
      id: "poster-still-life",
      photos: ["flowers-vase"],
      title: "Still Life",
      format: "poster",
      category: "events",
      tags: ["exhibition", "gallery", "minimal", "art"],
      background: solid("#FAFAF7"),
      nodes: [
        text("number", "Number", "N° 07", { x: 220, y: 120, w: 300, h: 40 }, { family: "Inter", weight: 600, size: 26, color: "#6B6B6B" }),
        photo("photo", "Photo", { x: 220, y: 200, w: 800, h: 1100 }),
        text("title", "Title", "Still Life", { x: 220, y: 1350, w: 740, h: 130 }, { family: "Playfair Display", italic: true, size: 110, color: "#1A1A1A", maxChars: 30 }),
        ellipse("dot", "Dot", { x: 980, y: 1392, w: 40, h: 40 }, solid(RUST)),
        text("subtitle", "Subtitle", "Photographs 2019–2025", { x: 220, y: 1490, w: 800, h: 44 }, { family: "Inter", weight: 500, size: 30, letterSpacing: 2, color: "#6B6B6B", maxChars: 40 }),
        text("venue", "Venue", "Gallery 3 · Opens 4 Nov", { x: 620, y: 1640, w: 400, h: 40 }, { family: "Inter", weight: 500, size: 26, color: "#1A1A1A", align: "right", maxChars: 40 }),
      ],
    }),

    // ── Invitation (1500 × 2100) ─────────────────────────────────────────────
    template({
      id: "invite-arch-wedding",
      photos: ["wedding-couple"],
      title: "Arch Wedding",
      format: "invitation",
      category: "invitations",
      tags: ["wedding", "invitation", "arch", "elegant"],
      background: solid("#FBF7F0"),
      nodes: [
        rect("border", "Border", { x: 60, y: 60, w: 1380, h: 1980 }, null, { stroke: { color: "#C8A96A", width: 3 } }),
        text("intro", "Intro", "Together with their families", { x: 250, y: 160, w: 1000, h: 60 }, { family: "Lora", italic: true, size: 40, color: "#7A6A58", align: "center", maxChars: 50 }),
        photo("photo", "Couple photo", { x: 400, y: 280, w: 700, h: 900 }, "arch"),
        text("names", "Names", "Ananya & Rohan", { x: 100, y: 1230, w: 1300, h: 200 }, { family: "Dancing Script", weight: 700, size: 150, color: "#5B4636", align: "center", maxChars: 36 }),
        text("request", "Request", "request the pleasure of your company", { x: 200, y: 1450, w: 1100, h: 60 }, { family: "Lora", size: 42, color: "#7A6A58", align: "center", maxChars: 60 }),
        rect("divider", "Divider", { x: 690, y: 1550, w: 120, h: 3 }, solid("#C8A96A")),
        text("date", "Date", "Sunday, 14 December", { x: 150, y: 1600, w: 1200, h: 80 }, { family: "Playfair Display", weight: 700, size: 56, color: "#3E3228", align: "center", maxChars: 40 }),
        text("venue", "Venue", "The Palms Garden · 6:30 in the evening", { x: 150, y: 1700, w: 1200, h: 60 }, { family: "Lora", size: 40, color: "#7A6A58", align: "center", maxChars: 60 }),
        text("rsvp", "RSVP", "RSVP by 1 December", { x: 400, y: 1860, w: 700, h: 44 }, { family: "Inter", weight: 600, size: 30, letterSpacing: 6, color: "#C8A96A", align: "center", maxChars: 40 }),
      ],
    }),
    template({
      id: "invite-balloon-party",
      photos: ["kid-balloons"],
      title: "Balloon Party",
      format: "invitation",
      category: "invitations",
      tags: ["kids", "birthday", "balloons", "pastel"],
      background: linear(180, "#E0F4FF", "#FFE9F3"),
      nodes: [
        rect("string-1", "String", { x: 309, y: 500, w: 3, h: 200 }, solid("#9A8FA8")),
        rect("string-2", "String", { x: 499, y: 420, w: 3, h: 240 }, solid("#9A8FA8")),
        rect("string-3", "String", { x: 989, y: 420, w: 3, h: 240 }, solid("#9A8FA8")),
        rect("string-4", "String", { x: 1189, y: 520, w: 3, h: 200 }, solid("#9A8FA8")),
        ellipse("balloon-1", "Balloon", { x: 180, y: 180, w: 260, h: 320 }, solid("#FF8FB1")),
        ellipse("balloon-2", "Balloon", { x: 380, y: 120, w: 240, h: 300 }, solid("#8FD3FF")),
        ellipse("balloon-3", "Balloon", { x: 880, y: 140, w: 220, h: 280 }, solid("#B8A6FF")),
        ellipse("balloon-4", "Balloon", { x: 1060, y: 200, w: 260, h: 320 }, solid("#FFD27A")),
        text("title", "Title", "You're invited!", { x: 100, y: 720, w: 1300, h: 180 }, { family: "Pacifico", size: 130, color: "#E0527E", align: "center", maxChars: 30 }),
        photo("photo", "Birthday photo", { x: 500, y: 930, w: 500, h: 500 }, "ellipse"),
        text("who", "Who", "Kabir is turning 5", { x: 100, y: 1480, w: 1300, h: 110 }, { family: "Poppins", weight: 700, size: 80, color: "#2C2A4A", align: "center", maxChars: 40 }),
        text("when", "When", "Sunday, 3 PM · Sunshine Play Café", { x: 100, y: 1620, w: 1300, h: 64 }, { family: "Poppins", weight: 500, size: 44, color: "#5B587A", align: "center", maxChars: 60 }),
        text("fun", "Fun line", "Games, cake and lots of balloons", { x: 100, y: 1760, w: 1300, h: 90 }, { family: "Caveat", weight: 700, size: 64, color: "#E0527E", align: "center", maxChars: 50 }),
      ],
    }),
    template({
      id: "invite-supper-club",
      photos: ["dinner-table"],
      title: "Supper Club",
      format: "invitation",
      category: "invitations",
      tags: ["dinner", "supper club", "elegant", "dark"],
      background: solid("#23291F"),
      nodes: [
        rect("border", "Border", { x: 80, y: 80, w: 1340, h: 1940 }, null, { stroke: { color: "#D4B06A", width: 2 } }),
        text("kicker", "Kicker", "SUPPER CLUB", { x: 250, y: 200, w: 1000, h: 50 }, { family: "Inter", weight: 700, size: 36, letterSpacing: 14, color: "#D4B06A", align: "center" }),
        text("title", "Title", "An evening of slow food", { x: 150, y: 300, w: 1200, h: 260 }, { family: "Playfair Display", italic: true, size: 110, lineHeight: 1.1, color: "#F3EEDF", align: "center", maxChars: 40 }),
        photo("photo", "Table photo", { x: 250, y: 620, w: 1000, h: 700 }, "rect", 8),
        text("menu", "Menu", "Burrata & heirloom tomato · Wood-fired lamb · Saffron poached pear", { x: 200, y: 1390, w: 1100, h: 220 }, { family: "Lora", size: 44, lineHeight: 1.6, color: "#E5DDC8", align: "center", maxChars: 160 }),
        text("when", "When", "Saturday, 7:30 PM", { x: 200, y: 1680, w: 1100, h: 80 }, { family: "Playfair Display", weight: 700, size: 60, color: "#D4B06A", align: "center", maxChars: 40 }),
        text("notes", "Notes", "Dress: garden formal · Bring a friend", { x: 200, y: 1800, w: 1100, h: 50 }, { family: "Inter", weight: 500, size: 34, color: "#BFB7A2", align: "center", maxChars: 60 }),
      ],
    }),
    template({
      id: "invite-festive-greetings",
      photos: ["family-lights"],
      title: "Festive Greetings",
      format: "invitation",
      category: "invitations",
      tags: ["festive", "greetings", "telugu", "family"],
      background: linear(160, "#7A1F3D", "#3B0D1E"),
      nodes: [
        ellipse("ring-outer", "Ring", { x: 250, y: 250, w: 1000, h: 1000, opacity: 0.6 }, null, { stroke: { color: "#E9B949", width: 4 } }),
        ellipse("ring-inner", "Ring", { x: 330, y: 330, w: 840, h: 840, opacity: 0.4 }, null, { stroke: { color: "#E9B949", width: 2 } }),
        polygon("mandala", "Mandala", { x: 450, y: 450, w: 600, h: 600, opacity: 0.15 }, 12, solid("#E9B949")),
        photo("photo", "Family photo", { x: 500, y: 500, w: 500, h: 500 }, "ellipse"),
        text("greeting", "Greeting", "శుభాకాంక్షలు", { x: 100, y: 1300, w: 1300, h: 160 }, { family: "Noto Sans Telugu", weight: 700, size: 110, color: "#F7D774", align: "center", maxChars: 30 }),
        text("wishes", "Wishes", "Warm wishes to you and your family", { x: 150, y: 1480, w: 1200, h: 90 }, { family: "Playfair Display", italic: true, size: 60, color: "#FCEBD0", align: "center", maxChars: 50 }),
        text("invite", "Invite", "Join us for dinner · Saturday, 7 PM", { x: 150, y: 1640, w: 1200, h: 60 }, { family: "Inter", weight: 600, size: 40, color: "#F2D9A8", align: "center", maxChars: 50 }),
        text("from", "From", "With love, the Reddy family", { x: 150, y: 1780, w: 1200, h: 90 }, { family: "Caveat", weight: 700, size: 64, color: "#F7D774", align: "center", maxChars: 50 }),
      ],
    }),
    // ── More Instagram posts ────────────────────────────────────────────────
    template({
      id: "post-travel-postcard",
      photos: ["mountain-lake"],
      title: "Travel Postcard",
      format: "ig-post",
      category: "photo-posts",
      tags: ["travel", "postcard", "mountains", "holiday"],
      background: solid("#F7F2E8"),
      nodes: [
        photo("photo", "Photo", { x: 60, y: 60, w: 960, h: 720 }, "rect", 24),
        text("greeting", "Greeting", "greetings from", { x: 60, y: 800, w: 960, h: 80 }, { family: "Caveat", weight: 700, size: 64, color: "#2B2B2B", align: "center", maxChars: 30 }),
        text("place", "Place", "THE MOUNTAINS", { x: 60, y: 870, w: 960, h: 130 }, { family: "Bebas Neue", size: 124, color: "#1F3A2E", align: "center", maxChars: 20 }),
        text("handle", "Handle", "@yourhandle", { x: 60, y: 1005, w: 960, h: 36 }, { family: "Inter", weight: 500, size: 22, color: "#6B6259", align: "center" }),
      ],
    }),
    template({
      id: "post-new-arrivals",
      photos: ["fashion-model", "clothes-rack"],
      title: "New Arrivals",
      format: "ig-post",
      category: "sales",
      tags: ["fashion", "new in", "shop", "dark"],
      background: solid("#111111"),
      nodes: [
        photo("left", "Left photo", { x: 40, y: 40, w: 490, h: 760 }, "rect", 20),
        photo("right", "Right photo", { x: 550, y: 40, w: 490, h: 760 }, "rect", 20),
        text("title", "Title", "NEW ARRIVALS", { x: 40, y: 830, w: 1000, h: 110 }, { family: "Archivo Black", size: 96, color: "#FFFFFF", maxChars: 20 }),
        text("subtitle", "Subtitle", "The autumn edit, in store and online now", { x: 40, y: 950, w: 800, h: 44 }, { family: "Inter", size: 28, color: "#BDBDBD", maxChars: 60 }),
        text("cta", "Call to action", "SHOP", { x: 880, y: 955, w: 160, h: 40 }, { family: "Inter", weight: 700, size: 26, letterSpacing: 6, color: "#FFE14D", align: "right", maxChars: 10 }),
      ],
    }),
    template({
      id: "post-hiring",
      photos: ["team-office"],
      title: "We're Hiring",
      format: "ig-post",
      category: "announcements",
      tags: ["hiring", "jobs", "team", "careers"],
      background: solid("#0F2A4A"),
      nodes: [
        photo("photo", "Team photo", { x: 0, y: 0, w: 1080, h: 560 }),
        text("title", "Title", "WE'RE HIRING", { x: 70, y: 620, w: 940, h: 100 }, { family: "Archivo Black", size: 88, color: "#FFFFFF", maxChars: 24 }),
        text("role", "Role", "Product designer · Full time · Bengaluru or remote", { x: 70, y: 735, w: 940, h: 90 }, { family: "Inter", size: 30, lineHeight: 1.4, color: "#C9D6E8", maxChars: 90 }),
        rect("button", "Button", { x: 70, y: 880, w: 380, h: 90 }, solid("#4FD1C5"), { radius: 16 }),
        text("button-label", "Button label", "Apply via link in bio", { x: 70, y: 905, w: 380, h: 40 }, { family: "Poppins", weight: 600, size: 28, color: "#0F2A4A", align: "center", maxChars: 26 }),
        text("handle", "Handle", "@yourcompany", { x: 640, y: 990, w: 370, h: 36 }, { family: "Inter", size: 22, color: "#7F95B2", align: "right" }),
      ],
    }),
    template({
      id: "post-anniversary",
      photos: ["couple-sunset"],
      title: "Anniversary",
      format: "ig-post",
      category: "celebrations",
      tags: ["anniversary", "love", "couple", "warm"],
      background: linear(180, "#FFE8D6", "#FFD1BA"),
      nodes: [
        ellipse("ring", "Photo ring", { x: 300, y: 100, w: 480, h: 480 }, solid("#FFFFFF")),
        photo("photo", "Couple photo", { x: 320, y: 120, w: 440, h: 440 }, "ellipse"),
        text("title", "Title", "5 years", { x: 90, y: 620, w: 900, h: 150 }, { family: "Pacifico", size: 110, color: "#C8553D", align: "center", maxChars: 20 }),
        text("subtitle", "Subtitle", "and counting, with you", { x: 90, y: 780, w: 900, h: 64 }, { family: "Playfair Display", italic: true, size: 44, color: "#7A3E2E", align: "center", maxChars: 40 }),
        text("since", "Since", "SINCE JUNE 2021", { x: 90, y: 880, w: 900, h: 40 }, { family: "Inter", weight: 600, size: 26, letterSpacing: 6, color: "#7A3E2E", align: "center", maxChars: 30 }),
      ],
    }),
    template({
      id: "post-minimal-portrait",
      photos: ["portrait-bw"],
      title: "Minimal Portrait",
      format: "ig-post",
      category: "photo-posts",
      tags: ["portrait", "black and white", "photography", "series"],
      background: solid("#EDEDED"),
      nodes: [
        photo("photo", "Portrait", { x: 80, y: 80, w: 560, h: 920 }),
        text("title", "Title", "Portraits", { x: 680, y: 120, w: 340, h: 130 }, { family: "DM Serif Display", italic: true, size: 96, color: "#1A1A1A", maxChars: 16 }),
        text("body", "Body", "A series on light, stillness and faces.", { x: 680, y: 280, w: 340, h: 150 }, { family: "Inter", size: 26, lineHeight: 1.45, color: "#555555", maxChars: 90 }),
        rect("line", "Line", { x: 680, y: 900, w: 60, h: 3 }, solid("#1A1A1A")),
        text("handle", "Handle", "@yourname", { x: 680, y: 925, w: 340, h: 36 }, { family: "Inter", weight: 500, size: 22, color: "#1A1A1A" }),
      ],
    }),
    template({
      id: "post-morning-quote",
      photos: ["sunrise-mountains"],
      title: "Morning Quote",
      format: "ig-post",
      category: "quotes-tips",
      tags: ["quote", "morning", "sunrise", "calm"],
      background: solid("#000000"),
      nodes: [
        photo("photo", "Background photo", { x: 0, y: 0, w: 1080, h: 1080 }),
        rect("card", "Text backing", { x: 120, y: 330, w: 840, h: 440 }, solid("#00000073"), { radius: 24 }),
        text("quote", "Quote", "Start where you are.", { x: 160, y: 380, w: 760, h: 260 }, { family: "DM Serif Display", size: 104, lineHeight: 1.05, color: "#FFFFFF", align: "center", maxChars: 60 }),
        text("greeting", "Greeting", "good morning", { x: 160, y: 660, w: 760, h: 80 }, { family: "Caveat", weight: 700, size: 60, color: "#FFE4B5", align: "center", maxChars: 30 }),
        text("handle", "Handle", "@yourhandle", { x: 90, y: 1000, w: 900, h: 36 }, { family: "Inter", weight: 500, size: 24, color: "#FFFFFF", align: "center" }),
      ],
    }),
    template({
      id: "post-photo-grid",
      photos: ["forest-trail", "ocean-waves", "desert-dunes", "snowy-peaks"],
      title: "Year in Places",
      format: "ig-post",
      category: "photo-posts",
      tags: ["grid", "recap", "travel", "collage"],
      background: solid("#FFFFFF"),
      nodes: [
        photo("p1", "Photo 1", { x: 30, y: 30, w: 500, h: 500 }, "rect", 16),
        photo("p2", "Photo 2", { x: 550, y: 30, w: 500, h: 500 }, "rect", 16),
        photo("p3", "Photo 3", { x: 30, y: 550, w: 500, h: 500 }, "rect", 16),
        photo("p4", "Photo 4", { x: 550, y: 550, w: 500, h: 500 }, "rect", 16),
        ellipse("badge", "Badge", { x: 400, y: 400, w: 280, h: 280 }, solid("#FFFFFF")),
        text("title", "Title", "2026 in places", { x: 420, y: 480, w: 240, h: 120 }, { family: "Poppins", weight: 700, size: 44, lineHeight: 1.1, color: "#1A1A1A", align: "center", maxChars: 24 }),
      ],
    }),

    // ── More stories ────────────────────────────────────────────────────────
    template({
      id: "story-coffee-morning",
      photos: ["latte-art"],
      title: "Coffee Morning",
      format: "ig-story",
      category: "menus",
      tags: ["coffee", "cafe", "morning", "warm"],
      background: linear(180, "#F3E9DC", "#E6D3BD"),
      nodes: [
        text("title", "Title", "slow mornings", { x: 90, y: 90, w: 900, h: 140 }, { family: "Caveat", weight: 700, size: 110, color: "#5B3A29", align: "center", maxChars: 30 }),
        photo("photo", "Coffee photo", { x: 120, y: 260, w: 840, h: 1100 }, "arch"),
        text("body", "Body", "Oat latte, fresh bread and nowhere to be.", { x: 140, y: 1420, w: 800, h: 110 }, { family: "Inter", size: 34, lineHeight: 1.35, color: "#6F4E37", align: "center", maxChars: 80 }),
        rect("divider", "Divider", { x: 490, y: 1570, w: 100, h: 4 }, solid("#6F4E37")),
        text("details", "Details", "OPEN 7 AM · 12 BAKER STREET", { x: 90, y: 1610, w: 900, h: 40 }, { family: "Inter", weight: 600, size: 26, letterSpacing: 4, color: "#5B3A29", align: "center", maxChars: 50 }),
      ],
    }),
    template({
      id: "story-workout",
      photos: ["workout"],
      title: "Workout Plan",
      format: "ig-story",
      category: "quotes-tips",
      tags: ["fitness", "workout", "gym", "plan"],
      background: solid("#0B0B0B"),
      nodes: [
        photo("photo", "Photo", { x: 0, y: 0, w: 1080, h: 1200 }),
        text("eyebrow", "Eyebrow", "TODAY'S WORKOUT", { x: 80, y: 1250, w: 920, h: 44 }, { family: "Inter", weight: 700, size: 30, letterSpacing: 6, color: "#C6FF3D", maxChars: 30 }),
        text("title", "Title", "Upper body\npush day", { x: 80, y: 1310, w: 920, h: 240 }, { family: "Archivo Black", size: 104, lineHeight: 1.05, color: "#FFFFFF", maxChars: 40 }),
        text("plan", "Plan", "Bench press 4 × 8\nShoulder press 3 × 10\nPush-ups 3 × 15", { x: 80, y: 1590, w: 920, h: 190 }, { family: "Inter", size: 36, lineHeight: 1.5, color: "#BDBDBD", maxChars: 140 }),
      ],
    }),
    template({
      id: "story-plant-sale",
      photos: ["plants"],
      title: "Plant Sale",
      format: "ig-story",
      category: "sales",
      tags: ["plants", "sale", "green", "shop"],
      background: solid("#E7F0E4"),
      nodes: [
        text("title", "Title", "PLANT SALE", { x: 60, y: 160, w: 960, h: 160 }, { family: "Archivo Black", size: 140, color: "#1F4D2B", align: "center", maxChars: 16 }),
        text("offer", "Offer", "Up to 30% off indoor plants", { x: 90, y: 340, w: 900, h: 64 }, { family: "Poppins", weight: 600, size: 44, color: "#2F6B3D", align: "center", maxChars: 40 }),
        photo("photo", "Plant photo", { x: 140, y: 470, w: 800, h: 1060 }, "arch"),
        text("details", "Details", "This weekend only · Green Corner Nursery", { x: 90, y: 1600, w: 900, h: 50 }, { family: "Inter", size: 32, color: "#1F4D2B", align: "center", maxChars: 60 }),
        rect("button", "Button", { x: 290, y: 1700, w: 500, h: 110 }, solid("#1F4D2B"), { radius: 24 }),
        text("button-label", "Button label", "Visit the shop", { x: 290, y: 1727, w: 500, h: 56 }, { family: "Poppins", weight: 700, size: 40, color: "#FFFFFF", align: "center", maxChars: 20 }),
      ],
    }),

    // ── More thumbnails ─────────────────────────────────────────────────────
    template({
      id: "thumb-podcast",
      photos: ["podcast-mic"],
      title: "Podcast Episode",
      format: "yt-thumbnail",
      category: "thumbnails",
      tags: ["podcast", "episode", "dark", "interview"],
      background: solid("#16161A"),
      nodes: [
        photo("photo", "Photo", { x: 760, y: 0, w: 520, h: 720 }),
        text("episode", "Episode", "EP. 12", { x: 70, y: 90, w: 500, h: 40 }, { family: "Inter", weight: 700, size: 30, letterSpacing: 6, color: "#FF5A36", maxChars: 12 }),
        text("title", "Title", "Why small brands win", { x: 70, y: 150, w: 640, h: 320 }, { family: "Archivo Black", size: 88, lineHeight: 1.0, color: "#FFFFFF", maxChars: 40 }),
        rect("line", "Line", { x: 70, y: 510, w: 120, h: 8 }, solid("#FF5A36")),
        text("guest", "Guest", "with Priya Nair", { x: 70, y: 545, w: 640, h: 50 }, { family: "Poppins", weight: 500, size: 36, color: "#CFCFD6", maxChars: 40 }),
      ],
    }),
    template({
      id: "thumb-road-trip",
      photos: ["road-trip"],
      title: "Road Trip",
      format: "yt-thumbnail",
      category: "thumbnails",
      tags: ["road trip", "travel", "vlog", "adventure"],
      background: solid("#000000"),
      nodes: [
        photo("photo", "Photo", { x: 0, y: 0, w: 1280, h: 720 }),
        rect("shade", "Shade", { x: 0, y: 420, w: 1280, h: 300 }, linear(180, "#00000000", "#000000CC")),
        text("title", "Title", "ROAD TRIP", { x: 60, y: 440, w: 1100, h: 170 }, { family: "Archivo Black", size: 150, color: "#FFFFFF", maxChars: 16 }),
        text("subtitle", "Subtitle", "5 days · 1,200 km · 1 tiny car", { x: 60, y: 620, w: 1100, h: 60 }, { family: "Poppins", weight: 600, size: 40, color: "#FFE14D", maxChars: 50 }),
      ],
    }),

    // ── More posters ────────────────────────────────────────────────────────
    template({
      id: "poster-book-club",
      photos: ["books"],
      title: "Book Club",
      format: "poster",
      category: "events",
      tags: ["books", "reading", "club", "community"],
      background: solid("#F4EDE1"),
      nodes: [
        text("title", "Title", "BOOK CLUB", { x: 90, y: 90, w: 1060, h: 230 }, { family: "Bebas Neue", size: 220, color: "#3A2E25", align: "center", maxChars: 16 }),
        photo("photo", "Photo", { x: 220, y: 360, w: 800, h: 900 }, "rect", 12),
        text("book", "This month", "This month: The Remains of the Day", { x: 120, y: 1320, w: 1000, h: 150 }, { family: "Playfair Display", weight: 700, size: 56, lineHeight: 1.15, color: "#3A2E25", align: "center", maxChars: 70 }),
        text("when", "When", "Last Thursday of the month · 7 PM · Corner Café", { x: 120, y: 1500, w: 1000, h: 50 }, { family: "Inter", size: 30, color: "#6B5B4E", align: "center", maxChars: 70 }),
        text("welcome", "Welcome", "Everyone welcome. Bring a friend.", { x: 120, y: 1580, w: 1000, h: 50 }, { family: "Inter", weight: 600, size: 30, color: "#A0522D", align: "center", maxChars: 50 }),
      ],
    }),
    template({
      id: "poster-farmers-market",
      photos: ["vegetables", "fruit"],
      title: "Farmers' Market",
      format: "poster",
      category: "announcements",
      tags: ["market", "local", "fresh", "weekend"],
      background: solid("#FFF8E7"),
      nodes: [
        text("title", "Title", "Farmers' Market", { x: 90, y: 100, w: 1060, h: 180 }, { family: "DM Serif Display", size: 140, color: "#2F5D31", align: "center", maxChars: 24 }),
        text("tagline", "Tagline", "FRESH · LOCAL · SEASONAL", { x: 90, y: 300, w: 1060, h: 50 }, { family: "Inter", weight: 700, size: 34, letterSpacing: 8, color: "#D0782A", align: "center", maxChars: 40 }),
        photo("left", "Left photo", { x: 90, y: 400, w: 520, h: 760 }, "rect", 24),
        photo("right", "Right photo", { x: 630, y: 400, w: 520, h: 760 }, "rect", 24),
        text("when", "When", "Every Saturday · 8 AM to 1 PM", { x: 90, y: 1240, w: 1060, h: 70 }, { family: "Poppins", weight: 600, size: 48, color: "#2F5D31", align: "center", maxChars: 50 }),
        text("where", "Where", "Town Square Park", { x: 90, y: 1330, w: 1060, h: 50 }, { family: "Inter", size: 36, color: "#5A6B4E", align: "center", maxChars: 40 }),
      ],
    }),

    // ── More invitations ────────────────────────────────────────────────────
    template({
      id: "invite-graduation",
      photos: ["graduate"],
      title: "Graduation Party",
      format: "invitation",
      category: "invitations",
      tags: ["graduation", "party", "celebration", "navy"],
      background: solid("#0E1B2E"),
      nodes: [
        text("eyebrow", "Eyebrow", "CLASS OF 2026", { x: 150, y: 180, w: 1200, h: 60 }, { family: "Inter", weight: 700, size: 40, letterSpacing: 10, color: "#E9C46A", align: "center", maxChars: 24 }),
        photo("photo", "Graduate photo", { x: 400, y: 320, w: 700, h: 900 }, "arch"),
        text("title", "Title", "Graduation party", { x: 150, y: 1290, w: 1200, h: 150 }, { family: "DM Serif Display", size: 120, color: "#FFFFFF", align: "center", maxChars: 30 }),
        text("name", "Name", "Join us to celebrate Aarav", { x: 150, y: 1460, w: 1200, h: 70 }, { family: "Poppins", weight: 500, size: 48, color: "#D8DEE9", align: "center", maxChars: 40 }),
        rect("divider", "Divider", { x: 700, y: 1580, w: 100, h: 4 }, solid("#E9C46A")),
        text("details", "Details", "Sunday, 14 June · 6 PM\nThe Garden Hall", { x: 150, y: 1630, w: 1200, h: 150 }, { family: "Inter", size: 40, lineHeight: 1.5, color: "#D8DEE9", align: "center", maxChars: 70 }),
      ],
    }),
    template({
      id: "invite-baby-shower",
      photos: ["baby-toys"],
      title: "Baby Shower",
      format: "invitation",
      category: "invitations",
      tags: ["baby shower", "soft", "pastel", "celebration"],
      background: linear(180, "#EAF4F4", "#FDF1E7"),
      nodes: [
        text("title", "Title", "Oh baby!", { x: 150, y: 170, w: 1200, h: 220 }, { family: "Pacifico", size: 150, color: "#5C8D89", align: "center", maxChars: 20 }),
        ellipse("ring", "Photo ring", { x: 430, y: 450, w: 640, h: 640 }, solid("#FFFFFF")),
        photo("photo", "Photo", { x: 450, y: 470, w: 600, h: 600 }, "ellipse"),
        text("name", "Name", "Baby shower for Meera", { x: 150, y: 1170, w: 1200, h: 110 }, { family: "Playfair Display", weight: 700, size: 80, color: "#3D5A58", align: "center", maxChars: 40 }),
        text("details", "Details", "Saturday, 20 July · 4 PM\n24 Lake View Road", { x: 150, y: 1320, w: 1200, h: 150 }, { family: "Inter", size: 44, lineHeight: 1.5, color: "#5C6B6A", align: "center", maxChars: 70 }),
        text("rsvp", "RSVP", "RSVP by 10 July", { x: 150, y: 1540, w: 1200, h: 56 }, { family: "Inter", weight: 600, size: 36, color: "#C98A5A", align: "center", maxChars: 30 }),
      ],
    }),

    // ── Film, collage, moodboard and pin styles (original layouts) ──────────
    template({
      id: "post-film-frame",
      photos: ["golden-hour"],
      title: "Film Frame",
      format: "ig-post",
      category: "photo-posts",
      tags: ["film", "grain", "minimal", "date stamp"],
      background: solid("#F5F3EE"),
      nodes: [
        filmed(photo("photo", "Photo", { x: 60, y: 60, w: 960, h: 820 }), "film"),
        text("stamp", "Date stamp", "’26 10 07", { x: 740, y: 806, w: 260, h: 54 }, { family: "Space Grotesk", weight: 700, size: 40, color: "#F04E00", align: "right", maxChars: 12 }),
        text("roll", "Roll", "ROLL 03 · FRAME 17", { x: 60, y: 912, w: 560, h: 36 }, { family: "Space Grotesk", weight: 500, size: 22, letterSpacing: 4, color: "#8A8278", maxChars: 30 }),
        text("caption", "Caption", "late light on the way home", { x: 60, y: 952, w: 760, h: 64 }, { family: "Lora", italic: true, size: 38, color: "#2C2925", maxChars: 50 }),
      ],
    }),
    template({
      id: "story-quiet-journal",
      photos: ["forest-trail", "ocean-waves"],
      title: "Quiet Journal",
      format: "ig-story",
      category: "photo-posts",
      tags: ["journal", "film", "faded", "minimal"],
      background: solid("#EFEDE8"),
      nodes: [
        text("title", "Title", "october, slowly", { x: 90, y: 120, w: 900, h: 90 }, { family: "Lora", italic: true, size: 64, color: "#3A3631", align: "center", maxChars: 30 }),
        filmed(photo("photo1", "Photo", { x: 90, y: 250, w: 900, h: 700 }), "fade"),
        filmed(photo("photo2", "Photo", { x: 240, y: 990, w: 750, h: 560 }), "fade"),
        rect("line", "Line", { x: 90, y: 1600, w: 60, h: 3 }, solid("#3A3631")),
        text("note", "Note", "two walks, one long weekend, no plans.", { x: 90, y: 1630, w: 820, h: 110 }, { family: "Inter", size: 32, lineHeight: 1.5, color: "#5C5750", maxChars: 80 }),
        text("handle", "Handle", "@yourhandle", { x: 90, y: 1780, w: 420, h: 40 }, { family: "Inter", weight: 500, size: 24, color: "#8A8278" }),
      ],
    }),
    template({
      id: "poster-photo-walk",
      photos: ["portrait-bw"],
      title: "Photo Walk",
      format: "poster",
      category: "events",
      tags: ["photography", "black and white", "walk", "meetup"],
      background: solid("#111111"),
      nodes: [
        filmed(photo("photo", "Photo", { x: 80, y: 80, w: 1080, h: 1180 }), "noir"),
        text("eyebrow", "Eyebrow", "A PHOTO WALK", { x: 80, y: 1300, w: 640, h: 44 }, { family: "Inter", weight: 700, size: 26, letterSpacing: 8, color: "#BDBDBD", maxChars: 30 }),
        text("title", "Title", "Streets in black and white", { x: 80, y: 1352, w: 1080, h: 200 }, { family: "DM Serif Display", size: 96, lineHeight: 1, color: "#F5F5F5", maxChars: 60 }),
        text("details", "Details", "Sunday 9 AM · Meet at the old clock tower · Bring any camera", { x: 80, y: 1580, w: 880, h: 100 }, { family: "Inter", size: 28, lineHeight: 1.4, color: "#9E9E9E", maxChars: 120 }),
        rect("badge", "Badge outline", { x: 1000, y: 1594, w: 160, h: 64 }, null, { radius: 12, stroke: { color: "#F5F5F5", width: 3 } }),
        text("price", "Price", "FREE", { x: 1000, y: 1604, w: 160, h: 44 }, { family: "Inter", weight: 700, size: 26, letterSpacing: 4, color: "#F5F5F5", align: "center", maxChars: 8 }),
      ],
    }),
    template({
      id: "post-offset-collage",
      photos: ["city-street", "latte-art", "cafe-interior"],
      title: "Offset Collage",
      format: "ig-post",
      category: "photo-posts",
      tags: ["collage", "grid", "city", "white border"],
      background: solid("#FFFFFF"),
      nodes: [
        photo("photo1", "Large photo", { x: 60, y: 60, w: 560, h: 620 }),
        photo("photo2", "Top photo", { x: 660, y: 60, w: 360, h: 420 }),
        photo("photo3", "Bottom photo", { x: 660, y: 520, w: 360, h: 500 }),
        text("count", "Count", "01 / 03", { x: 60, y: 730, w: 240, h: 36 }, { family: "Space Grotesk", weight: 500, size: 22, color: "#9A9A9A", maxChars: 12 }),
        text("title", "Title", "City notes", { x: 60, y: 780, w: 560, h: 120 }, { family: "Bricolage Grotesque", weight: 800, size: 96, color: "#111111", maxChars: 24 }),
        text("body", "Body", "Coffee, corners and the 8:40 train.", { x: 60, y: 912, w: 560, h: 90 }, { family: "Inter", size: 28, lineHeight: 1.4, color: "#555555", maxChars: 80 }),
      ],
    }),
    template({
      id: "story-film-strip",
      photos: ["road-trip", "desert-dunes", "mountain-lake"],
      title: "Film Strip",
      format: "ig-story",
      category: "photo-posts",
      tags: ["film strip", "road trip", "travel", "retro"],
      background: solid("#E9E4DA"),
      nodes: [
        rect("strip", "Film strip", { x: 240, y: 120, w: 600, h: 1520 }, solid("#161412"), { radius: 8 }),
        sprockets("holes-left", { x: 262, y: 150, w: 16, h: 1460 }, "#E9E4DA"),
        sprockets("holes-right", { x: 802, y: 150, w: 16, h: 1460 }, "#E9E4DA"),
        filmed(photo("photo1", "Photo", { x: 300, y: 170, w: 480, h: 440 }), "film"),
        filmed(photo("photo2", "Photo", { x: 300, y: 650, w: 480, h: 440 }), "film"),
        filmed(photo("photo3", "Photo", { x: 300, y: 1130, w: 480, h: 440 }), "film"),
        text("frame1", "Frame number", "24", { x: 300, y: 614, w: 100, h: 30 }, { family: "Space Grotesk", weight: 600, size: 20, color: "#FF8A3D", maxChars: 6 }),
        text("frame2", "Frame number", "25A", { x: 300, y: 1094, w: 100, h: 30 }, { family: "Space Grotesk", weight: 600, size: 20, color: "#FF8A3D", maxChars: 6 }),
        text("title", "Title", "road trip, roll two", { x: 90, y: 1680, w: 900, h: 100 }, { family: "Caveat", weight: 700, size: 84, color: "#2B2B2B", align: "center", maxChars: 30 }),
        text("dates", "Dates", "AUGUST 2026", { x: 290, y: 1790, w: 500, h: 44 }, { family: "Inter", weight: 700, size: 26, letterSpacing: 6, color: "#6B6259", align: "center", maxChars: 24 }),
      ],
    }),
    template({
      id: "thumb-mountain-panels",
      photos: ["snowy-peaks", "sunrise-mountains", "forest-trail"],
      title: "Mountain Panels",
      format: "yt-thumbnail",
      category: "thumbnails",
      tags: ["travel", "vlog", "mountains", "panels"],
      background: solid("#0E0E0E"),
      nodes: [
        photo("photo1", "Left photo", { x: 0, y: 0, w: 420, h: 720 }),
        photo("photo2", "Middle photo", { x: 430, y: 0, w: 420, h: 720 }),
        photo("photo3", "Right photo", { x: 860, y: 0, w: 420, h: 720 }),
        rect("band", "Shade", { x: 0, y: 460, w: 1280, h: 260, opacity: 0.6 }, solid("#000000")),
        text("title", "Title", "3 DAYS IN THE MOUNTAINS", { x: 50, y: 480, w: 1100, h: 140 }, { family: "Bebas Neue", size: 124, color: "#FFFFFF", maxChars: 40 }),
        text("subtitle", "Subtitle", "what it really cost", { x: 50, y: 628, w: 760, h: 60 }, { family: "Inter", weight: 700, size: 38, color: "#FFD25A", maxChars: 40 }),
      ],
    }),
    template({
      id: "post-moodboard",
      photos: ["flowers-vase", "plants", "tea-cup", "books"],
      title: "Moodboard",
      format: "ig-post",
      category: "photo-posts",
      tags: ["moodboard", "palette", "grid", "autumn"],
      background: solid("#F7F5F0"),
      nodes: [
        text("title", "Title", "mood / autumn", { x: 60, y: 50, w: 640, h: 56 }, { family: "Inter", weight: 600, size: 32, color: "#2B2925", maxChars: 30 }),
        text("year", "Year", "2026", { x: 780, y: 50, w: 240, h: 56 }, { family: "Inter", weight: 600, size: 32, color: "#2B2925", align: "right", maxChars: 10 }),
        photo("photo1", "Photo", { x: 60, y: 130, w: 470, h: 400 }, "rect", 12),
        photo("photo2", "Photo", { x: 550, y: 130, w: 470, h: 400 }, "rect", 12),
        photo("photo3", "Photo", { x: 60, y: 550, w: 470, h: 330 }, "rect", 12),
        photo("photo4", "Photo", { x: 550, y: 550, w: 470, h: 330 }, "rect", 12),
        ...swatches("swatch", 60, 920, 60, 80, ["#C7A27C", "#8E9775", "#E2D3C1", "#5B4636", "#D9CBB0"]),
        text("palette", "Palette", "clay, sage, linen, walnut, oat", { x: 480, y: 928, w: 540, h: 44 }, { family: "Inter", size: 24, color: "#6B655D", align: "right", maxChars: 60 }),
      ],
    }),
    template({
      id: "poster-new-collection",
      photos: ["fashion-model", "clothes-rack", "sneakers"],
      title: "New Collection Board",
      format: "poster",
      category: "sales",
      tags: ["new collection", "fashion", "moodboard", "shop"],
      background: solid("#EDE9E3"),
      nodes: [
        text("title", "Title", "New in: The Linen Edit", { x: 80, y: 80, w: 1080, h: 230 }, { family: "Playfair Display", weight: 700, size: 110, lineHeight: 1, color: "#1D1B18", maxChars: 40 }),
        photo("photo1", "Large photo", { x: 80, y: 340, w: 520, h: 760 }, "rect", 16),
        photo("photo2", "Photo", { x: 640, y: 340, w: 520, h: 360 }, "rect", 16),
        photo("photo3", "Photo", { x: 640, y: 740, w: 520, h: 360 }, "rect", 16),
        ...swatches("swatch", 80, 1150, 70, 90, ["#E8DCCB", "#B9A88F", "#6E6A5E", "#2E2C29"]),
        text("colours", "Colours", "Oat · Sand · Olive · Ink", { x: 460, y: 1162, w: 700, h: 48 }, { family: "Inter", size: 28, color: "#5A554C", align: "right", maxChars: 50 }),
        text("details", "Details", "In store and online from Friday. Sizes XS to XXL.", { x: 80, y: 1280, w: 900, h: 110 }, { family: "Inter", size: 32, lineHeight: 1.4, color: "#3B3833", maxChars: 100 }),
        rect("button", "Button", { x: 80, y: 1460, w: 440, h: 96 }, solid("#1D1B18"), { radius: 12 }),
        text("cta", "Button text", "SHOP THE EDIT", { x: 80, y: 1486, w: 440, h: 44 }, { family: "Inter", weight: 700, size: 28, letterSpacing: 4, color: "#F5F1EA", align: "center", maxChars: 20 }),
        text("handle", "Handle", "@yourshop", { x: 820, y: 1490, w: 340, h: 40 }, { family: "Inter", weight: 500, size: 28, color: "#5A554C", align: "right" }),
      ],
    }),
    template({
      id: "thumb-design-references",
      photos: ["modern-building", "arch-window", "city-street", "cafe-interior"],
      title: "Design References",
      format: "yt-thumbnail",
      category: "thumbnails",
      tags: ["design", "inspiration", "grid", "creator"],
      background: solid("#F2F2F0"),
      nodes: [
        text("title", "Title", "WHERE I FIND DESIGN IDEAS", { x: 50, y: 110, w: 540, h: 340 }, { family: "Archivo Black", size: 74, lineHeight: 1, color: "#111111", maxChars: 50 }),
        rect("tag", "Tag", { x: 50, y: 500, w: 320, h: 72 }, solid("#FF5A36"), { radius: 12 }),
        text("tag-text", "Tag text", "MY 4 SOURCES", { x: 50, y: 516, w: 320, h: 40 }, { family: "Inter", weight: 700, size: 30, color: "#FFFFFF", align: "center", maxChars: 20 }),
        photo("photo1", "Photo", { x: 620, y: 40, w: 300, h: 300 }, "rect", 16),
        photo("photo2", "Photo", { x: 940, y: 40, w: 300, h: 300 }, "rect", 16),
        photo("photo3", "Photo", { x: 620, y: 380, w: 300, h: 300 }, "rect", 16),
        photo("photo4", "Photo", { x: 940, y: 380, w: 300, h: 300 }, "rect", 16),
      ],
    }),
    template({
      id: "poster-recipe-card",
      photos: ["pasta-bowl"],
      title: "Recipe Card",
      format: "poster",
      category: "menus",
      tags: ["recipe", "food", "cooking", "pin"],
      background: solid("#FFF8EF"),
      nodes: [
        photo("photo", "Dish photo", { x: 0, y: 0, w: 1240, h: 760 }),
        text("eyebrow", "Eyebrow", "15-MINUTE DINNER", { x: 80, y: 810, w: 700, h: 40 }, { family: "Inter", weight: 700, size: 26, letterSpacing: 6, color: "#C2410C", maxChars: 30 }),
        text("title", "Title", "Lemon garlic pasta", { x: 80, y: 860, w: 1080, h: 130 }, { family: "Playfair Display", weight: 700, size: 88, color: "#2A211B", maxChars: 40 }),
        text("meta", "Time and servings", "Serves 2 · 15 min · Easy", { x: 80, y: 1000, w: 800, h: 44 }, { family: "Inter", weight: 500, size: 30, color: "#6B5E53", maxChars: 50 }),
        rect("divider", "Divider", { x: 80, y: 1070, w: 1080, h: 3 }, solid("#E7D9C7")),
        text("needs-title", "Ingredients heading", "You need", { x: 80, y: 1110, w: 500, h: 50 }, { family: "Inter", weight: 700, size: 32, color: "#2A211B", maxChars: 24 }),
        text("needs", "Ingredients", "200 g spaghetti\n2 lemons\n4 cloves garlic\nOlive oil, salt, pepper\nParmesan to serve", { x: 80, y: 1170, w: 500, h: 400 }, { family: "Inter", size: 28, lineHeight: 1.6, color: "#4A3F36", maxChars: 220 }),
        text("method-title", "Method heading", "Method", { x: 640, y: 1110, w: 520, h: 50 }, { family: "Inter", weight: 700, size: 32, color: "#2A211B", maxChars: 24 }),
        text("method", "Method", "1. Boil the pasta.\n2. Warm the garlic in oil.\n3. Add lemon and a splash of pasta water.\n4. Toss, season and serve.", { x: 640, y: 1170, w: 520, h: 400 }, { family: "Inter", size: 28, lineHeight: 1.6, color: "#4A3F36", maxChars: 260 }),
        text("handle", "Handle", "@yourkitchen", { x: 80, y: 1650, w: 420, h: 40 }, { family: "Inter", weight: 500, size: 26, color: "#C2410C" }),
      ],
    }),
    template({
      id: "story-quote-pin",
      photos: ["plants"],
      title: "Garden Quote",
      format: "ig-story",
      category: "quotes-tips",
      tags: ["quote", "calm", "plants", "pin"],
      background: solid("#1B2A24"),
      nodes: [
        filmed(photo("photo", "Arch photo", { x: 190, y: 150, w: 700, h: 900 }, "arch"), "fade"),
        text("mark", "Quote mark", "“", { x: 90, y: 1080, w: 160, h: 160 }, { family: "DM Serif Display", size: 200, color: "#D8C3A5", maxChars: 2 }),
        text("quote", "Quote", "Grow at your own pace. Roots first, then leaves.", { x: 90, y: 1210, w: 900, h: 380 }, { family: "DM Serif Display", size: 72, lineHeight: 1.15, color: "#F3EDE2", maxChars: 100 }),
        text("source", "Source", "Notes from the garden", { x: 90, y: 1630, w: 760, h: 48 }, { family: "Inter", weight: 500, size: 30, color: "#B9C4BC", maxChars: 40 }),
        text("handle", "Handle", "@yourhandle", { x: 90, y: 1790, w: 420, h: 40 }, { family: "Inter", weight: 500, size: 24, color: "#7E8C84" }),
      ],
    }),
    template({
      id: "story-step-guide",
      title: "Step-by-Step Guide",
      format: "ig-story",
      category: "quotes-tips",
      tags: ["tips", "steps", "how to", "pin"],
      background: solid("#FFF4E6"),
      nodes: [
        text("title", "Title", "4 steps to a calmer morning", { x: 90, y: 130, w: 900, h: 270 }, { family: "Bricolage Grotesque", weight: 700, size: 92, lineHeight: 1.05, color: "#2A1F14", maxChars: 60 }),
        ...howToStep(1, 470, "Wake at the same time", "Even on weekends. Your body likes a rhythm."),
        ...howToStep(2, 790, "Water before coffee", "One glass first, then the good stuff."),
        ...howToStep(3, 1110, "Ten minutes of daylight", "Open a window or step outside."),
        ...howToStep(4, 1430, "Write one line", "What would make today good?"),
        text("footer", "Footer", "Save this for tomorrow", { x: 90, y: 1790, w: 640, h: 44 }, { family: "Inter", weight: 600, size: 28, color: "#B45309", maxChars: 40 }),
      ],
    }),
    template({
      id: "invite-garden-party",
      photos: ["dinner-table"],
      title: "Garden Party",
      format: "invitation",
      category: "invitations",
      tags: ["garden party", "dinner", "arch", "botanical"],
      background: solid("#F6F1E7"),
      nodes: [
        ellipse("leaf-1", "Leaf", { x: 290, y: 1090, w: 130, h: 54, rotation: -30 }, solid("#8FA57A")),
        ellipse("leaf-2", "Leaf", { x: 1080, y: 1090, w: 130, h: 54, rotation: 30 }, solid("#8FA57A")),
        filmed(photo("photo", "Arch photo", { x: 350, y: 180, w: 800, h: 1000 }, "arch"), "warm"),
        text("lead", "Lead-in", "you're invited to a", { x: 250, y: 1240, w: 1000, h: 110 }, { family: "Dancing Script", weight: 700, size: 84, color: "#6F7D5C", align: "center", maxChars: 40 }),
        text("title", "Title", "Garden Party", { x: 150, y: 1350, w: 1200, h: 200 }, { family: "Playfair Display", weight: 700, size: 150, color: "#2F3B2A", align: "center", maxChars: 30 }),
        text("details", "Details", "Saturday, 14 June · 5 PM\nThe Banyan Courtyard", { x: 250, y: 1600, w: 1000, h: 150 }, { family: "Lora", size: 46, lineHeight: 1.4, color: "#4E5A47", align: "center", maxChars: 90 }),
        text("rsvp", "RSVP", "RSVP by 1 June", { x: 450, y: 1820, w: 600, h: 56 }, { family: "Inter", weight: 600, size: 34, letterSpacing: 4, color: "#6F7D5C", align: "center", maxChars: 30 }),
      ],
    }),
  ];
}

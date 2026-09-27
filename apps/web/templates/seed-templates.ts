/**
 * The 20 seed templates, authored in code until Author Mode exists (spec §8.3).
 * Original designs; style cues only from current editorial / social trends — no copied artwork.
 * `pnpm --filter @vash/web templates:build` writes them to templates/seed/*.json.
 */
import { defaultFilters, FORMATS, type Doc, type Fill, type FormatKey, type FrameNode, type Lock, type Node, type ShapeNode, type TextNode } from "@vash/schema";

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

interface Definition {
  id: string;
  title: string;
  format: Exclude<FormatKey, "custom">;
  category: string;
  tags: string[];
  background: Fill;
  nodes: Node[];
}

function template(d: Definition): Doc {
  const size = FORMATS[d.format];
  return {
    schemaVersion: 1,
    id: d.id,
    kind: "template",
    meta: { title: d.title, category: d.category, tags: d.tags, format: d.format },
    artboard: { width: size.width, height: size.height, background: d.background },
    root: d.nodes.map((n) => n.id),
    nodes: Object.fromEntries(d.nodes.map((n) => [n.id, n])),
    assets: {},
  };
}

const RUST = "#BC361B";

export function seedTemplates(): Doc[] {
  return [
    // ── Instagram post (1080 × 1080) ─────────────────────────────────────────
    template({
      id: "post-editorial-bloom",
      title: "Editorial Bloom",
      format: "ig-post",
      category: "minimal",
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
      title: "Confetti Birthday",
      format: "ig-post",
      category: "birthday",
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
      title: "Chef's Special",
      format: "ig-post",
      category: "food",
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
      category: "quotes",
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
      title: "Weekend Photo Dump",
      format: "ig-story",
      category: "travel",
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
      title: "Flash Sale Drop",
      format: "ig-story",
      category: "sale",
      tags: ["sale", "discount", "gradient", "shop"],
      background: linear(160, "#2D5BFF", "#8A2BE2"),
      nodes: [
        text("eyebrow", "Eyebrow", "NEW DROP · 48 HOURS ONLY", { x: 90, y: 160, w: 900, h: 44 }, { family: "Inter", weight: 700, size: 30, letterSpacing: 5, color: "#FFFFFF", align: "center", maxChars: 40 }),
        text("offer", "Offer", "50% OFF", { x: 60, y: 240, w: 960, h: 220 }, { family: "Archivo Black", size: 190, lineHeight: 0.95, color: "#FFFFFF", align: "center", maxChars: 12 }),
        photo("photo", "Product photo", { x: 140, y: 540, w: 800, h: 900 }, "rect", 48),
        polygon("burst", "Burst", { x: 760, y: 470, w: 240, h: 240, rotation: 12 }, 12, solid("#FFE14D")),
        text("burst-label", "Burst label", "EVERYTHING", { x: 760, y: 565, w: 240, h: 50, rotation: 12 }, { family: "Archivo Black", size: 26, color: "#1A1A1A", align: "center", maxChars: 12 }),
        rect("cta-pill", "Button", { x: 290, y: 1560, w: 500, h: 120 }, solid("#FFFFFF"), { radius: 60 }),
        text("cta", "Button label", "Shop the sale", { x: 290, y: 1590, w: 500, h: 60 }, { family: "Poppins", weight: 700, size: 44, color: "#2D5BFF", align: "center", maxChars: 20 }),
        text("hint", "Hint", "Link in bio", { x: 290, y: 1730, w: 500, h: 40 }, { family: "Inter", weight: 500, size: 28, color: "#E6E0FF", align: "center" }),
      ],
    }),
    template({
      id: "story-countdown",
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
      category: "quotes",
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
      title: "Three Tips",
      format: "yt-thumbnail",
      category: "business",
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
      title: "48 Hours In",
      format: "yt-thumbnail",
      category: "travel",
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
      title: "Quick Recipe",
      format: "yt-thumbnail",
      category: "food",
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
      title: "Head to Head",
      format: "yt-thumbnail",
      category: "business",
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
      title: "Now Open",
      format: "poster",
      category: "business",
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
      title: "Still Life",
      format: "poster",
      category: "minimal",
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
      title: "Arch Wedding",
      format: "invitation",
      category: "events",
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
      title: "Balloon Party",
      format: "invitation",
      category: "birthday",
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
      title: "Supper Club",
      format: "invitation",
      category: "food",
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
      title: "Festive Greetings",
      format: "invitation",
      category: "events",
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
  ];
}

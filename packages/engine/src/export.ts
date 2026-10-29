import type { Doc } from "@vash/schema";
import type { FilterFn } from "./filters";
import { fontRequests } from "./fonts";
import { renderDoc, type Ctx, type ImageState } from "./render";
import { drawOrder } from "./scene";
import type { Measure } from "./text";

/** Browsers cap canvas sides (and memory); 8192 px keeps every major browser happy. */
export const EXPORT_MAX_SIDE = 8192;

export type ExportCheck = { ok: true; width: number; height: number } | { ok: false; reason: string; maxScale: number };

/** Print extras: bleed is painted past each trim edge; crop marks sit in a margin outside the bleed. */
export interface PrintOptions {
  /** Design px of artboard beyond each trim edge, 0 to 30. */
  bleed?: number;
  cropMarks?: boolean;
}

export const MAX_BLEED = 30;
/** Design px of margin on every side when crop marks are on, outside the bleed. */
export const CROP_MARGIN = 24;
/** Design px from the bleed edge to the start of each mark, and the length of each mark. */
const MARK_GAP = 6;
const MARK_LENGTH = 12;
/** 0.25 pt in CSS pixels (96 per inch, 72 points per inch). */
const MARK_WIDTH = (0.25 * 96) / 72;

export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Output geometry for an export. Sizes and coordinates are in output pixels unless a field says design px. */
export interface ExportLayout {
  width: number;
  height: number;
  /** Page size in design px: the artboard plus bleed and the crop-mark margin. */
  pageWidth: number;
  pageHeight: number;
  /** Distance from the output edge to the trim edge. */
  inset: number;
  /** How far the bleed reaches past the trim. */
  bleed: number;
  /** Crop mark lines: two per trim corner, none without crop marks. */
  marks: Segment[];
  /** Line width for the marks, at least one device pixel. */
  markWidth: number;
}

const clampBleed = (bleed = 0) => (Number.isFinite(bleed) ? Math.min(MAX_BLEED, Math.max(0, bleed)) : 0);

/**
 * The export's size and crop-mark geometry at `scale`. The trim sits inset by the bleed, plus CROP_MARGIN when
 * crop marks are on. Each mark starts beyond the bleed and runs away from the trim corner, along the trim edge.
 */
export function exportLayout(doc: Doc, scale: number, print: PrintOptions = {}): ExportLayout {
  const bleed = clampBleed(print.bleed);
  const margin = bleed + (print.cropMarks ? CROP_MARGIN : 0);
  const pageWidth = doc.artboard.width + 2 * margin;
  const pageHeight = doc.artboard.height + 2 * margin;
  const inset = margin * scale;
  const reach = (bleed + MARK_GAP) * scale;
  const length = MARK_LENGTH * scale;
  const marks: Segment[] = [];
  if (print.cropMarks) {
    const xs = [
      [inset, -1],
      [inset + doc.artboard.width * scale, 1],
    ] as const;
    const ys = [
      [inset, -1],
      [inset + doc.artboard.height * scale, 1],
    ] as const;
    for (const [x, sx] of xs) {
      for (const [y, sy] of ys) {
        marks.push({ x1: x + sx * reach, y1: y, x2: x + sx * (reach + length), y2: y });
        marks.push({ x1: x, y1: y + sy * reach, x2: x, y2: y + sy * (reach + length) });
      }
    }
  }
  return {
    width: Math.round(pageWidth * scale),
    height: Math.round(pageHeight * scale),
    pageWidth,
    pageHeight,
    inset,
    bleed: bleed * scale,
    marks,
    markWidth: Math.max(1, MARK_WIDTH * scale),
  };
}

export function checkExport(doc: Doc, scale: number, print: PrintOptions = {}): ExportCheck {
  const { width, height, pageWidth, pageHeight } = exportLayout(doc, scale, print);
  if (width <= EXPORT_MAX_SIDE && height <= EXPORT_MAX_SIDE) return { ok: true, width, height };
  const maxScale = Math.floor(EXPORT_MAX_SIDE / Math.max(pageWidth, pageHeight));
  return { ok: false, reason: `That's larger than ${EXPORT_MAX_SIDE} px on a side. Try ${maxScale}×.`, maxScale };
}

export interface ExportOptions extends PrintOptions {
  scale: number;
  transparent: boolean;
  measure: Measure;
  /** Full-resolution images for export (not the on-screen working copies). */
  image: (assetId: string) => ImageState;
  /** Resolves once the given photos have finished loading (or failed); lets export wait for them. */
  imagesReady?: (assetIds: string[]) => Promise<void>;
  filter?: FilterFn;
}

/** Every photo and sticker the visible design draws. */
export function referencedImages(doc: Doc): string[] {
  const ids = new Set<string>();
  if (doc.artboard.background.type === "image") ids.add(doc.artboard.background.assetId);
  for (const id of drawOrder(doc)) {
    const n = doc.nodes[id];
    if (n?.type === "frame" && n.content) ids.add(n.content.assetId);
    if (n?.type === "sticker") ids.add(n.assetId);
  }
  return [...ids];
}

export const PHOTOS_NOT_READY = "Some photos haven't loaded, so the image would have empty spaces. Check your connection and try again.";

export type ImageFormat = "png" | "jpeg";

const DEFAULT_QUALITY = 0.92;

/** The encoder MIME type and a quality clamped to 0..1 (only JPEG uses it; the canvas ignores it for PNG). */
export function encodeOptions(format: ImageFormat, quality = DEFAULT_QUALITY): { type: "image/png" | "image/jpeg"; quality: number } {
  const q = Number.isFinite(quality) ? Math.min(1, Math.max(0, quality)) : DEFAULT_QUALITY;
  return { type: format === "jpeg" ? "image/jpeg" : "image/png", quality: q };
}

/** JPEG has no transparency, so a JPEG always gets the background fill. */
export function paintsBackground(format: ImageFormat, transparent: boolean): boolean {
  return format === "jpeg" || !transparent;
}

/**
 * Renders the artboard at `scale` to an image once the design's fonts and photos have loaded. Refuses
 * rather than export a photo as an empty box.
 */
/**
 * renderDoc paints the background and clips to the artboard from its origin. The bleed is drawn by a copy of the
 * design whose artboard is the bleed rectangle and whose top-level layers move by the bleed.
 */
function bleedDoc(doc: Doc, bleed: number): Doc {
  if (bleed === 0) return doc;
  const nodes = { ...doc.nodes };
  for (const id of doc.root) {
    const n = nodes[id];
    if (n) nodes[id] = { ...n, transform: { ...n.transform, x: n.transform.x + bleed, y: n.transform.y + bleed } };
  }
  const { artboard } = doc;
  return { ...doc, artboard: { ...artboard, width: artboard.width + 2 * bleed, height: artboard.height + 2 * bleed }, nodes };
}

function drawCropMarks(ctx: Ctx, layout: ExportLayout): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.strokeStyle = "#000";
  ctx.lineWidth = layout.markWidth;
  ctx.beginPath();
  for (const s of layout.marks) {
    ctx.moveTo(s.x1, s.y1);
    ctx.lineTo(s.x2, s.y2);
  }
  ctx.stroke();
}

export async function exportImage(doc: Doc, o: ExportOptions & { format: ImageFormat; quality?: number }): Promise<Blob> {
  const size = checkExport(doc, o.scale, o);
  if (!size.ok) throw new Error(size.reason);
  const layout = exportLayout(doc, o.scale, o);
  const photos = referencedImages(doc);
  await o.imagesReady?.(photos);
  if (photos.some((id) => typeof o.image(id) !== "object")) throw new Error(PHOTOS_NOT_READY);
  if (typeof document !== "undefined" && document.fonts) {
    await Promise.all(fontRequests(doc).map((f) => document.fonts.load(f).catch(() => [])));
  }
  const offscreen = typeof OffscreenCanvas !== "undefined";
  const canvas = offscreen ? new OffscreenCanvas(size.width, size.height) : Object.assign(document.createElement("canvas"), size);
  const ctx = canvas.getContext("2d") as Ctx | null;
  if (!ctx) throw new Error("Your browser couldn't create an image this size.");
  const background = paintsBackground(o.format, o.transparent);
  // The crop-mark margin is outside the bleed. Fill it white so a JPEG (or an opaque PNG) has no transparent corners.
  if (o.cropMarks && background) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, size.width, size.height);
  }
  // The trim lands `inset` from the edge; the bleed copy starts `bleed` further out.
  const shift = layout.inset - layout.bleed;
  renderDoc(ctx, bleedDoc(doc, clampBleed(o.bleed)), [o.scale, 0, 0, o.scale, shift, shift], { measure: o.measure, image: o.image, filter: o.filter, dpr: o.scale }, { background });
  if (layout.marks.length) drawCropMarks(ctx, layout);
  const encode = encodeOptions(o.format, o.quality);
  if (canvas instanceof HTMLCanvasElement) {
    return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Export failed."))), encode.type, encode.quality));
  }
  return canvas.convertToBlob(encode);
}

/** Renders the artboard at `scale` to a PNG. See exportImage. */
export function exportPng(doc: Doc, o: ExportOptions): Promise<Blob> {
  return exportImage(doc, { ...o, format: "png" });
}

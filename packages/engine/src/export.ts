import type { Doc } from "@vash/schema";
import type { FilterFn } from "./filters";
import { fontRequests } from "./fonts";
import { renderDoc, type Ctx, type ImageState } from "./render";
import type { Measure } from "./text";

/** Browsers cap canvas sides (and memory); 8192 px keeps every major browser happy. */
export const EXPORT_MAX_SIDE = 8192;

export type ExportCheck = { ok: true; width: number; height: number } | { ok: false; reason: string; maxScale: number };

export function checkExport(doc: Doc, scale: number): ExportCheck {
  const width = Math.round(doc.artboard.width * scale);
  const height = Math.round(doc.artboard.height * scale);
  if (width <= EXPORT_MAX_SIDE && height <= EXPORT_MAX_SIDE) return { ok: true, width, height };
  const maxScale = Math.floor(EXPORT_MAX_SIDE / Math.max(doc.artboard.width, doc.artboard.height));
  return { ok: false, reason: `That's larger than ${EXPORT_MAX_SIDE} px on a side. Try ${maxScale}×.`, maxScale };
}

export interface ExportOptions {
  scale: number;
  transparent: boolean;
  measure: Measure;
  /** Full-resolution images for export (not the on-screen working copies). */
  image: (assetId: string) => ImageState;
  filter?: FilterFn;
}

/** Renders the artboard at `scale` to a PNG, after the document's fonts have loaded. */
export async function exportPng(doc: Doc, o: ExportOptions): Promise<Blob> {
  const size = checkExport(doc, o.scale);
  if (!size.ok) throw new Error(size.reason);
  if (typeof document !== "undefined" && document.fonts) {
    await Promise.all(fontRequests(doc).map((f) => document.fonts.load(f).catch(() => [])));
  }
  const offscreen = typeof OffscreenCanvas !== "undefined";
  const canvas = offscreen ? new OffscreenCanvas(size.width, size.height) : Object.assign(document.createElement("canvas"), size);
  const ctx = canvas.getContext("2d") as Ctx | null;
  if (!ctx) throw new Error("Your browser couldn't create an image this size.");
  renderDoc(ctx, doc, [o.scale, 0, 0, o.scale, 0, 0], { measure: o.measure, image: o.image, filter: o.filter, dpr: o.scale }, { background: !o.transparent });
  if (canvas instanceof HTMLCanvasElement) {
    return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Export failed."))), "image/png"));
  }
  return canvas.convertToBlob({ type: "image/png" });
}

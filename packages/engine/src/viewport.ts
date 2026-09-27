import type { Point } from "./math";

/** screen = artboard × zoom + pan, in CSS pixels relative to the canvas element. */
export interface Viewport {
  zoom: number;
  panX: number;
  panY: number;
}

export const ZOOM_MIN = 0.05;
export const ZOOM_MAX = 8;

export const toScreen = (v: Viewport, p: Point): Point => ({ x: p.x * v.zoom + v.panX, y: p.y * v.zoom + v.panY });
export const toWorld = (v: Viewport, p: Point): Point => ({ x: (p.x - v.panX) / v.zoom, y: (p.y - v.panY) / v.zoom });

/** The zoom that shows the whole artboard inside the view with `padding` on every side, centred. */
export function fitViewport(view: { width: number; height: number }, artboard: { width: number; height: number }, padding = 48): Viewport {
  const zoom = clampZoom(Math.min((view.width - padding * 2) / artboard.width, (view.height - padding * 2) / artboard.height));
  return { zoom, panX: (view.width - artboard.width * zoom) / 2, panY: (view.height - artboard.height * zoom) / 2 };
}

const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

/** Change zoom to `zoom` while keeping the artboard point under `screen` where it is. */
export function zoomAt(v: Viewport, screen: Point, zoom: number): Viewport {
  const next = clampZoom(zoom);
  const anchor = toWorld(v, screen);
  return { zoom: next, panX: screen.x - anchor.x * next, panY: screen.y - anchor.y * next };
}

import { ZOOM_MAX, ZOOM_MIN } from "@vash/engine";

/** Zoom spans 5% to 800%, so the slider is logarithmic: each step is the same percentage change. */
export const SLIDER_STEPS = 1000;

const span = Math.log(ZOOM_MAX / ZOOM_MIN);

export function zoomToSlider(zoom: number): number {
  if (!Number.isFinite(zoom)) return 0;
  const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
  return Math.round((Math.log(z / ZOOM_MIN) / span) * SLIDER_STEPS);
}

export function sliderToZoom(value: number): number {
  const v = Math.min(SLIDER_STEPS, Math.max(0, value));
  return ZOOM_MIN * Math.exp((v / SLIDER_STEPS) * span);
}

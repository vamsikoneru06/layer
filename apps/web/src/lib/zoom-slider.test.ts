import { ZOOM_MAX, ZOOM_MIN } from "@vash/engine";
import { describe, expect, it } from "vitest";
import { SLIDER_STEPS, sliderToZoom, zoomToSlider } from "./zoom-slider";

describe("zoom slider", () => {
  it("maps the ends of the slider to the zoom limits", () => {
    expect(sliderToZoom(0)).toBeCloseTo(ZOOM_MIN);
    expect(sliderToZoom(SLIDER_STEPS)).toBeCloseTo(ZOOM_MAX);
    expect(zoomToSlider(ZOOM_MIN)).toBe(0);
    expect(zoomToSlider(ZOOM_MAX)).toBe(SLIDER_STEPS);
  });

  it("round-trips within one percent", () => {
    for (const z of [0.1, 0.5, 1, 2, 4]) expect(sliderToZoom(zoomToSlider(z)) / z).toBeCloseTo(1, 1);
  });

  it("clamps values outside the range and survives bad input", () => {
    expect(zoomToSlider(100)).toBe(SLIDER_STEPS);
    expect(zoomToSlider(0.0001)).toBe(0);
    expect(zoomToSlider(Number.NaN)).toBe(0);
    expect(sliderToZoom(-5)).toBeCloseTo(ZOOM_MIN);
    expect(sliderToZoom(SLIDER_STEPS * 2)).toBeCloseTo(ZOOM_MAX);
  });
});

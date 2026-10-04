import { describe, expect, it } from "vitest";
import { fitViewport, toScreen, toWorld, zoomAt } from "./viewport";

describe("viewport", () => {
  it("maps between artboard and screen space", () => {
    const v = { zoom: 0.5, panX: 100, panY: 40 };
    expect(toScreen(v, { x: 200, y: 100 })).toEqual({ x: 200, y: 90 });
    expect(toWorld(v, { x: 200, y: 90 })).toEqual({ x: 200, y: 100 });
  });

  it("fits and centres the artboard with padding", () => {
    // 1080×1920 story in an 800×600 view with 40 px padding: height limits, zoom = 520 / 1920.
    const v = fitViewport({ width: 800, height: 600 }, { width: 1080, height: 1920 }, 40);
    expect(v.zoom).toBeCloseTo(520 / 1920);
    expect(v.panY).toBeCloseTo(40);
    expect(v.panX).toBeCloseTo((800 - 1080 * v.zoom) / 2);
  });

  it("zooms about a screen point, keeping that point fixed, within limits", () => {
    const v = { zoom: 1, panX: 0, panY: 0 };
    const z = zoomAt(v, { x: 100, y: 100 }, 2);
    expect(z.zoom).toBe(2);
    expect(toWorld(z, { x: 100, y: 100 })).toEqual({ x: 100, y: 100 });
    expect(zoomAt(v, { x: 0, y: 0 }, 1000).zoom).toBe(8);
    expect(zoomAt(v, { x: 0, y: 0 }, 0.0001).zoom).toBe(0.05);
  });
});

import { defaultFilters, validateDoc } from "@vash/schema";
import { describe, expect, it, vi } from "vitest";
import { FILTER_PRESETS, hexToRgb, isNeutral, pixelateBlock, presetFilters } from "./filters";
import { recordingContext } from "./recording-ctx";
import { renderDoc } from "./render";
import { docWith, frame } from "./test-docs";

describe("filter presets", () => {
  it("are all valid documents' filters, with unique keys and labels", () => {
    const keys = FILTER_PRESETS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(FILTER_PRESETS.map((p) => p.label)).size).toBe(FILTER_PRESETS.length);
    for (const key of keys) {
      const doc = docWith([{ ...frame("f", { x: 500, y: 500 }), filters: presetFilters(key) }]);
      expect(validateDoc(doc)).toMatchObject({ ok: true });
      expect(presetFilters(key)).toMatchObject({ preset: key });
    }
  });

  it("start from neutral, and no preset means no change", () => {
    expect(isNeutral(defaultFilters())).toBe(true);
    expect(presetFilters(null)).toEqual(defaultFilters());
    expect(presetFilters("unknown")).toEqual(defaultFilters());
    expect(isNeutral(presetFilters("warm"))).toBe(false);
  });
});

describe("duotone and pixelate", () => {
  it("make filters non-neutral only when active", () => {
    expect(isNeutral({ ...defaultFilters(), pixelate: 0 })).toBe(true);
    expect(isNeutral({ ...defaultFilters(), duotone: null })).toBe(true);
    expect(isNeutral({ ...defaultFilters(), pixelate: 1 })).toBe(false);
    expect(isNeutral({ ...defaultFilters(), duotone: { light: "#F5E6C8", dark: "#2B2D42" } })).toBe(false);
  });

  it("pixelate blocks are a fraction of the shorter side, off at 0", () => {
    expect(pixelateBlock(0, 1000, 500)).toBe(0);
    expect(pixelateBlock(100, 1000, 500)).toBe(25);
    expect(pixelateBlock(50, 1000, 500)).toBe(12.5);
  });

  it("colours become 0 to 1 channels, ignoring alpha", () => {
    expect(hexToRgb("#FF8000")).toEqual([1, 128 / 255, 0]);
    expect(hexToRgb("#00000080")).toEqual([0, 0, 0]);
  });
});

describe("rendering filtered photos", () => {
  const source = { tag: "photo" } as unknown as CanvasImageSource;
  const filtered = { tag: "filtered" } as unknown as CanvasImageSource;
  const image = () => ({ source, width: 1000, height: 500 });
  const photoFrame = (filters = defaultFilters()) => ({ ...frame("f", { x: 150, y: 50 }, 300, 100), content: { assetId: "p", offsetX: 0, offsetY: 0, scale: 1 }, filters });
  const draws = (calls: { op: string; args: unknown[] }[]) => calls.filter((c) => c.op === "drawImage").map((c) => c.args[0]);

  it("filters at the drawn size, rounded up to a 128 px step and capped at the photo's own size", () => {
    const filter = vi.fn(() => filtered);
    const { ctx, calls } = recordingContext();
    renderDoc(ctx, docWith([photoFrame(presetFilters("warm"))]), [1, 0, 0, 1, 0, 0], { measure: () => 0, image, filter, dpr: 1 });
    // A 1000×500 photo covering a 300×100 frame is drawn 300×150: filtered at 384×192.
    // The 300×100 frame shows the middle 100 px of the 150 px tall photo: from 1/6 to 5/6 of its height.
    expect(filter).toHaveBeenCalledWith(source, 384, 192, expect.objectContaining({ preset: "warm" }), [0, 1 / 6, 1, 5 / 6]);
    expect(draws(calls)).toEqual([filtered]);
  });

  it("skips filtering neutral photos, and draws the original when filtering isn't available", () => {
    const filter = vi.fn(() => null);
    const neutral = recordingContext();
    renderDoc(neutral.ctx, docWith([photoFrame()]), [1, 0, 0, 1, 0, 0], { measure: () => 0, image, filter, dpr: 1 });
    expect(filter).not.toHaveBeenCalled();
    expect(draws(neutral.calls)).toEqual([source]);

    const unavailable = recordingContext();
    renderDoc(unavailable.ctx, docWith([photoFrame(presetFilters("mono"))]), [1, 0, 0, 1, 0, 0], { measure: () => 0, image, filter, dpr: 1 });
    expect(filter).toHaveBeenCalledTimes(1);
    expect(draws(unavailable.calls)).toEqual([source]);
  });

  it("sends an active duotone to the filter instead of skipping it as neutral", () => {
    const filter = vi.fn(() => null);
    const { ctx } = recordingContext();
    const duotone = { ...defaultFilters(), duotone: { light: "#F5E6C8", dark: "#2B2D42" } };
    renderDoc(ctx, docWith([photoFrame(duotone)]), [1, 0, 0, 1, 0, 0], { measure: () => 0, image, filter, dpr: 1 });
    expect(filter).toHaveBeenCalledWith(source, expect.any(Number), expect.any(Number), expect.objectContaining({ duotone: duotone.duotone }), expect.anything());
  });
});

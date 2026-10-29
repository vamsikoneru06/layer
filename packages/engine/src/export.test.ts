import { describe, expect, it } from "vitest";
import { checkExport, encodeOptions, exportPng, paintsBackground, PHOTOS_NOT_READY, referencedImages } from "./export";
import { recordingContext } from "./recording-ctx";
import { renderDoc } from "./render";
import { docWith, frame } from "./test-docs";

describe("checkExport", () => {
  it("gives the output size for a scale", () => {
    expect(checkExport(docWith([]), 2)).toEqual({ ok: true, width: 2000, height: 2000 });
  });

  it("refuses sizes over 8192 px per side and suggests the largest scale that fits", () => {
    const story = { ...docWith([]), artboard: { ...docWith([]).artboard, width: 1080, height: 1920 } };
    expect(checkExport(story, 3)).toEqual({ ok: true, width: 3240, height: 5760 });
    const huge = { ...story, artboard: { ...story.artboard, width: 4000, height: 3000 } };
    expect(checkExport(huge, 3)).toEqual({ ok: false, reason: expect.stringMatching(/8192/), maxScale: 2 });
  });
});

describe("renderDoc background option", () => {
  it("skips the background fill for a transparent export", () => {
    const withBg = recordingContext();
    renderDoc(withBg.ctx, docWith([]), [1, 0, 0, 1, 0, 0], { measure: () => 0, image: () => "loading", dpr: 1 });
    const transparent = recordingContext();
    renderDoc(transparent.ctx, docWith([]), [1, 0, 0, 1, 0, 0], { measure: () => 0, image: () => "loading", dpr: 1 }, { background: false });
    expect(withBg.calls.filter((c) => c.op === "fillRect")).toHaveLength(1);
    expect(transparent.calls.filter((c) => c.op === "fillRect")).toHaveLength(0);
  });
});

describe("encodeOptions", () => {
  it("picks the MIME type for each format", () => {
    expect(encodeOptions("png")).toEqual({ type: "image/png", quality: 0.92 });
    expect(encodeOptions("jpeg")).toEqual({ type: "image/jpeg", quality: 0.92 });
  });

  it("clamps quality to 0..1 and falls back to the default for non-finite input", () => {
    expect(encodeOptions("jpeg", 0.5).quality).toBe(0.5);
    expect(encodeOptions("jpeg", 2).quality).toBe(1);
    expect(encodeOptions("jpeg", -1).quality).toBe(0);
    expect(encodeOptions("jpeg", Number.NaN).quality).toBe(0.92);
  });
});

describe("paintsBackground", () => {
  it("keeps transparency for a transparent PNG only", () => {
    expect(paintsBackground("png", true)).toBe(false);
    expect(paintsBackground("png", false)).toBe(true);
  });

  it("always paints the background for JPEG, which has no alpha", () => {
    expect(paintsBackground("jpeg", true)).toBe(true);
    expect(paintsBackground("jpeg", false)).toBe(true);
  });
});

describe("exportPng with photos", () => {
  const withPhoto = () => docWith([{ ...frame("f", { x: 500, y: 500 }), content: { assetId: "p1", offsetX: 0, offsetY: 0, scale: 1 } }, frame("empty", { x: 100, y: 100 })]);

  it("lists the photos the design draws", () => {
    expect(referencedImages(withPhoto())).toEqual(["p1"]);
  });

  it("waits for the design's photos, and refuses rather than export an empty box", async () => {
    const waited: string[][] = [];
    const run = (state: "loading" | "missing") =>
      exportPng(withPhoto(), { scale: 1, transparent: false, measure: () => 0, image: () => state, imagesReady: async (ids) => void waited.push(ids) });
    await expect(run("loading")).rejects.toThrow(PHOTOS_NOT_READY);
    await expect(run("missing")).rejects.toThrow(PHOTOS_NOT_READY);
    expect(waited).toEqual([["p1"], ["p1"]]);
  });
});

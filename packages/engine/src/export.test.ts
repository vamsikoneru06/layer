import { describe, expect, it } from "vitest";
import { checkExport, encodeOptions, exportLayout, exportPng, paintsBackground, PHOTOS_NOT_READY, referencedImages } from "./export";
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

  it("checks the enlarged size when bleed or crop marks are on", () => {
    const doc = docWith([]);
    expect(checkExport(doc, 1, { bleed: 8 })).toEqual({ ok: true, width: 1016, height: 1016 });
    expect(checkExport(doc, 1, { cropMarks: true })).toEqual({ ok: true, width: 1048, height: 1048 });
    const huge = { ...doc, artboard: { ...doc.artboard, width: 4000, height: 3000 } };
    expect(checkExport(huge, 2, { bleed: 30 })).toEqual({ ok: true, width: 8120, height: 6120 });
    expect(checkExport(huge, 2, { bleed: 30, cropMarks: true })).toEqual({ ok: false, reason: expect.stringMatching(/8192/), maxScale: 1 });
  });
});

describe("exportLayout", () => {
  const doc = docWith([]); // 1000 × 1000 artboard

  it("is the artboard alone with no bleed or marks", () => {
    expect(exportLayout(doc, 1)).toEqual({ width: 1000, height: 1000, pageWidth: 1000, pageHeight: 1000, inset: 0, bleed: 0, marks: [], markWidth: 1 });
  });

  it("adds the bleed on every side", () => {
    expect(exportLayout(doc, 1, { bleed: 8 })).toMatchObject({ width: 1016, height: 1016, pageWidth: 1016, inset: 8, bleed: 8, marks: [] });
  });

  it("clamps bleed to 0 to 30 design px", () => {
    expect(exportLayout(doc, 1, { bleed: 99 })).toMatchObject({ width: 1060, inset: 30 });
    expect(exportLayout(doc, 1, { bleed: -4 })).toMatchObject({ width: 1000, inset: 0 });
  });

  it("adds a 24 px margin for crop marks and puts eight marks around the trim", () => {
    const layout = exportLayout(doc, 1, { cropMarks: true });
    expect(layout).toMatchObject({ width: 1048, height: 1048, inset: 24, bleed: 0 });
    expect(layout.marks).toHaveLength(8);
    // Top-left: each mark starts 6 px out from the trim corner and runs 12 px further out.
    expect(layout.marks).toContainEqual({ x1: 18, y1: 24, x2: 6, y2: 24 });
    expect(layout.marks).toContainEqual({ x1: 24, y1: 18, x2: 24, y2: 6 });
    // Bottom-right: the trim ends at 1024.
    expect(layout.marks).toContainEqual({ x1: 1030, y1: 1024, x2: 1042, y2: 1024 });
    expect(layout.marks).toContainEqual({ x1: 1024, y1: 1030, x2: 1024, y2: 1042 });
  });

  it("starts the marks beyond the bleed when both are on", () => {
    const layout = exportLayout(doc, 1, { bleed: 8, cropMarks: true });
    expect(layout).toMatchObject({ width: 1064, height: 1064, pageWidth: 1064, inset: 32, bleed: 8 });
    // The bleed reaches 8 px past the trim, so the top-left marks start 14 px out.
    expect(layout.marks).toContainEqual({ x1: 18, y1: 32, x2: 6, y2: 32 });
    expect(layout.marks).toContainEqual({ x1: 32, y1: 18, x2: 32, y2: 6 });
    expect(layout.marks).toContainEqual({ x1: 1032, y1: 1046, x2: 1032, y2: 1058 });
  });

  it("scales sizes and marks with the export scale, keeping marks at least 1 device px", () => {
    const layout = exportLayout(doc, 2, { cropMarks: true });
    expect(layout).toMatchObject({ width: 2096, height: 2096, inset: 48 });
    expect(layout.marks).toContainEqual({ x1: 36, y1: 48, x2: 12, y2: 48 });
    expect(layout.markWidth).toBe(1);
    expect(exportLayout(doc, 4, { cropMarks: true }).markWidth).toBeCloseTo(4 / 3);
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

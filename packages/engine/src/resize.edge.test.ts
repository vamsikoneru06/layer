import { validateDoc, type Doc, type FrameNode, type TextNode } from "@vash/schema";
import { describe, expect, it } from "vitest";
import { worldBounds } from "./hit-test";
import { resizeDoc } from "./resize";
import { docWith, frame, group, rect, text } from "./test-docs";

const STORY = { format: "ig-story" as const, width: 1080, height: 1920 };
const THUMB = { format: "yt-thumbnail" as const, width: 1280, height: 720 };

/** A 1000×1000 post with one full-bleed photo frame, a headline and a caption (same shape as resize.test.ts). */
function post(): Doc {
  const photo: FrameNode = {
    ...frame("bg", { x: 500, y: 500 }, 1000, 1000),
    placeholder: false,
    content: { assetId: "a1", offsetX: 40, offsetY: -20, scale: 1.2 },
  };
  const headline: TextNode = { ...text("title", { x: 500, y: 150 }, "Weekly specials", 800, 120), size: 96, letterSpacing: 2 };
  const caption: TextNode = { ...text("caption", { x: 500, y: 820 }, "Open daily", 600, 40), size: 28 };
  const doc = docWith([photo, headline, caption]);
  doc.assets.a1 = { id: "a1", kind: "photo", mime: "image/jpeg", width: 2000, height: 1500 };
  return doc;
}

describe("resizeDoc edge cases", () => {
  it("resizes a document with no layers into a valid document of the target size", () => {
    const empty = docWith([]);
    const { doc, warnings } = resizeDoc(empty, STORY);
    expect(validateDoc(doc).ok).toBe(true);
    expect(doc.artboard).toMatchObject({ width: 1080, height: 1920 });
    expect(doc.meta.format).toBe("ig-story");
    expect(doc.root).toEqual([]);
    expect(doc.nodes).toEqual({});
    expect(warnings).toEqual([]);
  });

  it("scales nested groups by the composition scale, at every depth", () => {
    // Composition scale for 1000x1000 -> 1280x720 is 0.72 (the tight side), not the 1.28 width factor.
    const s = 720 / 1000;
    const dot = rect("dot", { x: 20, y: -10 }, 50, 40);
    const other = rect("other", { x: -80, y: 30 }, 60, 60);
    const inner = group("inner", { x: 100, y: 50 }, ["dot"], 200, 100);
    const outer = group("outer", { x: 500, y: 500 }, ["inner", "other"], 400, 300);
    const source = docWith([outer], [inner, dot, other]);

    const { doc } = resizeDoc(source, THUMB);

    expect(doc.nodes.inner!.width).toBeCloseTo(200 * s);
    expect(doc.nodes.inner!.height).toBeCloseTo(100 * s);
    expect(doc.nodes.inner!.transform.x).toBeCloseTo(100 * s);
    expect(doc.nodes.inner!.transform.y).toBeCloseTo(50 * s);
    expect(doc.nodes.dot!.width).toBeCloseTo(50 * s);
    expect(doc.nodes.dot!.height).toBeCloseTo(40 * s);
    expect(doc.nodes.dot!.transform.x).toBeCloseTo(20 * s);
    expect(doc.nodes.dot!.transform.y).toBeCloseTo(-10 * s);
    expect(doc.nodes.other!.width).toBeCloseTo(60 * s);
    expect(doc.nodes.other!.height).toBeCloseTo(60 * s);
    expect(doc.nodes.other!.transform.x).toBeCloseTo(-80 * s);
    expect(doc.nodes.other!.transform.y).toBeCloseTo(30 * s);
    for (const id of ["inner", "dot", "other"]) {
      expect(doc.nodes[id]!.transform.scaleX).toBe(1);
      expect(doc.nodes[id]!.transform.scaleY).toBe(1);
    }
  });

  it("keeps the offsets of a full-bleed frame finite when its photo is missing from the document", () => {
    const bg: FrameNode = {
      ...frame("bg", { x: 500, y: 500 }, 1000, 1000),
      placeholder: false,
      content: { assetId: "missing", offsetX: 30, offsetY: -40, scale: 1.1 },
    };
    const source = docWith([bg]);
    expect(source.assets.missing).toBeUndefined();

    const { doc } = resizeDoc(source, STORY);
    const out = doc.nodes.bg as FrameNode;

    expect(out.width).toBe(1080);
    expect(out.height).toBe(1920);
    expect(Number.isFinite(out.content!.offsetX)).toBe(true);
    expect(Number.isFinite(out.content!.offsetY)).toBe(true);
    expect(Number.isFinite(out.content!.scale)).toBe(true);
  });

  it("keeps the width to height ratio of a shape that covers only half the artboard", () => {
    // 1000 x 500 at the centre covers 50% of the artboard, so it is not full-bleed and must not be stretched.
    const half = rect("half", { x: 500, y: 250 }, 1000, 500);
    const { doc } = resizeDoc(docWith([half]), STORY);

    // Composition scale is 1.08 (the tight side). Stretching would give 1080 x 960 instead.
    expect(doc.nodes.half!.width).toBeCloseTo(1000 * 1.08);
    expect(doc.nodes.half!.height).toBeCloseTo(500 * 1.08);
    expect(doc.nodes.half!.height / doc.nodes.half!.width).toBeCloseTo(0.5);
  });

  it("leaves positions and sizes unchanged when resized to the source size", () => {
    const source = post();
    const { doc, warnings } = resizeDoc(source, { format: "custom", width: 1000, height: 1000 });

    expect(doc.artboard).toMatchObject({ width: 1000, height: 1000 });
    expect(doc.meta.format).toBe("custom");
    for (const id of Object.keys(source.nodes)) {
      const before = source.nodes[id]!;
      const after = doc.nodes[id]!;
      expect(after.transform.x).toBeCloseTo(before.transform.x);
      expect(after.transform.y).toBeCloseTo(before.transform.y);
      expect(after.width).toBeCloseTo(before.width);
      expect(after.height).toBeCloseTo(before.height);
    }
    expect((doc.nodes.title as TextNode).size).toBeCloseTo(96);
    expect((doc.nodes.bg as FrameNode).content!.offsetX).toBeCloseTo(40);
    expect((doc.nodes.bg as FrameNode).content!.offsetY).toBeCloseTo(-20);
    expect(warnings).toEqual([]);
  });

  it("keeps sizes and positions within the format's limits when a tiny design is enlarged a lot", () => {
    // A 16×16 design made into an invitation is enlarged about 94 times; a 1100 px layer would be 103,125 px.
    const tiny = docWith([rect("big", { x: 8, y: 8 }, 1100, 1100)]);
    tiny.artboard = { ...tiny.artboard, width: 16, height: 16 };
    const { doc } = resizeDoc(tiny, { format: "invitation", width: 1500, height: 2100 });
    expect(validateDoc(doc).ok).toBe(true);
  });

  it("stretches a full-bleed group and its children to cover a new artboard size", () => {
    // A 1000x1000 group centred on the artboard, holding a full-size background rect and a headline.
    const bg = rect("bgRect", { x: 0, y: 0 }, 1000, 1000);
    const headline = text("headline", { x: 0, y: -300 }, "Weekly specials", 800, 120);
    const bgGroup = group("bgGroup", { x: 500, y: 500 }, ["bgRect", "headline"], 1000, 1000);
    const source = docWith([bgGroup], [bg, headline]);

    const { doc } = resizeDoc(source, STORY);
    const b = worldBounds(doc, "bgRect")!;

    expect(b.minX).toBeLessThanOrEqual(0.5);
    expect(b.minY).toBeLessThanOrEqual(0.5);
    expect(b.maxX).toBeGreaterThanOrEqual(1079.5);
    expect(b.maxY).toBeGreaterThanOrEqual(1919.5);
    expect(validateDoc(doc).ok).toBe(true);
  });
});

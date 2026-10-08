import { validateDoc, type Doc, type FrameNode, type TextNode } from "@vash/schema";
import { describe, expect, it } from "vitest";
import { worldBounds } from "./hit-test";
import { resizeDoc } from "./resize";
import { docWith, frame, group, rect, text } from "./test-docs";

const STORY = { format: "ig-story" as const, width: 1080, height: 1920 };
const THUMB = { format: "yt-thumbnail" as const, width: 1280, height: 720 };

/** A 1000×1000 post: full-bleed photo, a headline near the top, a caption and a badge group near the bottom. */
function post(): Doc {
  const photo: FrameNode = {
    ...frame("bg", { x: 500, y: 500 }, 1000, 1000),
    placeholder: false,
    content: { assetId: "a1", offsetX: 40, offsetY: -20, scale: 1.2 },
  };
  const headline: TextNode = { ...text("title", { x: 500, y: 150 }, "Weekly specials", 800, 120), size: 96, letterSpacing: 2 };
  const caption: TextNode = { ...text("caption", { x: 500, y: 820 }, "Open daily", 600, 40), size: 28 };
  const badge = group("badge", { x: 500, y: 650 }, ["dot"], 200, 200);
  const dot = { ...rect("dot", { x: 40, y: -30 }, 100, 60), stroke: { color: "#000000", width: 4 } };
  const doc = docWith([photo, headline, badge, caption], [dot]);
  doc.assets.a1 = { id: "a1", kind: "photo", mime: "image/jpeg", width: 2000, height: 1500 };
  return doc;
}

const inside = (doc: Doc, id: string) => {
  const b = worldBounds(doc, id)!;
  return b.minX >= -0.5 && b.minY >= -0.5 && b.maxX <= doc.artboard.width + 0.5 && b.maxY <= doc.artboard.height + 0.5;
};

describe("resizeDoc", () => {
  it("makes a valid design of the target size and format", () => {
    for (const target of [STORY, THUMB, { format: "poster" as const, width: 1240, height: 1754 }]) {
      const { doc } = resizeDoc(post(), target);
      expect(doc.artboard).toMatchObject({ width: target.width, height: target.height });
      expect(doc.meta.format).toBe(target.format);
      expect(validateDoc(doc).ok).toBe(true);
    }
  });

  it("stretches full-bleed layers to cover the new artboard, keeping the photo covering its frame", () => {
    const { doc } = resizeDoc(post(), STORY);
    const bg = doc.nodes.bg as FrameNode;
    expect(bg).toMatchObject({ width: 1080, height: 1920, transform: { x: 540, y: 960 } });
    // Zoom stays relative to "cover", so the taller frame is still covered; offsets stay within the photo.
    expect(bg.content!.scale).toBe(1.2);
    const fit = Math.max(1080 / 2000, 1920 / 1500) * 1.2;
    expect(Math.abs(bg.content!.offsetX)).toBeLessThanOrEqual((2000 * fit - 1080) / 2);
    expect(Math.abs(bg.content!.offsetY)).toBeLessThanOrEqual((1500 * fit - 1920) / 2);
  });

  it("scales the composition into the tight side and spreads it along the side that gained room", () => {
    const { doc } = resizeDoc(post(), STORY);
    const s = 1080 / 1000;
    const title = doc.nodes.title as TextNode;
    expect(title.width).toBeCloseTo(800 * s);
    expect(title.size).toBeCloseTo(96 * s);
    expect(title.letterSpacing).toBeCloseTo(2 * s);
    expect(title.transform.x).toBeCloseTo(540);
    // Spread vertically: the headline moves further up and the caption further down than plain scaling would put them.
    expect(title.transform.y).toBeLessThan(960 - (500 - 150) * s);
    expect(doc.nodes.caption!.transform.y).toBeGreaterThan(960 + (820 - 500) * s);
    // Top-to-bottom order is kept, and every layer stays on the artboard.
    const ys = ["title", "badge", "caption"].map((id) => doc.nodes[id]!.transform.y);
    expect([...ys].sort((a, b) => a - b)).toEqual(ys);
    for (const id of doc.root) expect(inside(doc, id)).toBe(true);
  });

  it("applies the scale to sizes inside groups instead of leaving a scale factor behind", () => {
    const { doc } = resizeDoc(post(), THUMB);
    const s = 720 / 1000;
    const dot = doc.nodes.dot!;
    expect(dot.transform).toMatchObject({ scaleX: 1, scaleY: 1 });
    expect(dot.width).toBeCloseTo(100 * s);
    expect(dot.transform.x).toBeCloseTo(40 * s);
    expect(dot.type === "shape" && dot.stroke!.width).toBeCloseTo(4 * s);
    expect(doc.nodes.badge!.width).toBeCloseTo(200 * s);
  });

  it("warns about text that shrinks below a readable size", () => {
    const { warnings } = resizeDoc(post(), THUMB);
    // The 28 px caption (about 10 pt on a phone) becomes about 20 px, 5 pt in a list of videos; the headline is fine.
    // On a story it's 30 px of 1080, the same 10 pt as before, so no warning.
    expect(warnings).toEqual([{ nodeId: "caption", size: expect.closeTo(28 * 0.72, 1) }]);
    expect(resizeDoc(post(), STORY).warnings).toEqual([]);
  });

  it("keeps rotated layers in the composition rather than stretching them", () => {
    const tilted = docWith([{ ...rect("r", { x: 500, y: 500, rotation: 10 }, 1000, 1000) }]);
    const { doc } = resizeDoc(tilted, STORY);
    expect(doc.nodes.r!.width).toBeCloseTo(doc.nodes.r!.height);
  });

  it("does not change the input document", () => {
    const original = post();
    const copy = structuredClone(original);
    resizeDoc(original, STORY);
    expect(original).toEqual(copy);
  });
});

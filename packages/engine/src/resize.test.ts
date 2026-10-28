import type { Doc, FrameNode, Node, ShapeNode, TextNode } from "@vash/schema";
import { describe, expect, it } from "vitest";
import { worldBounds } from "./hit-test";
import { clampContent } from "./photos";
import { adaptToSize } from "./resize";
import { docWith, frame, group, rect, text } from "./test-docs";

const POST = { width: 1080, height: 1080, format: "ig-post" as const };
const STORY = { width: 1080, height: 1920, format: "ig-story" as const };
const THUMB = { width: 1280, height: 720, format: "yt-thumbnail" as const };

const sized = (doc: Doc, size: { width: number; height: number }): Doc => ({ ...doc, artboard: { ...doc.artboard, ...size } });
const at = (x: number, y: number) => ({ x, y });
const words = (id: string, x: number, y: number, width: number, height: number, size: number): TextNode => ({ ...text(id, at(x, y), id, width, height), size });
const photo = (id: string, x: number, y: number, width: number, height: number): FrameNode => ({
  ...frame(id, at(x, y), width, height),
  content: { assetId: "a1", offsetX: 0, offsetY: 0, scale: 1 },
  placeholder: false,
});
const withPhoto = (doc: Doc): Doc => ({ ...doc, assets: { a1: { id: "a1", kind: "photo", mime: "image/jpeg", width: 3000, height: 2000 } } });

/** Every layer inside the design, and every photo still covering its frame. */
function expectSound(doc: Doc) {
  for (const id of doc.root) {
    const b = worldBounds(doc, id)!;
    expect(b.minX, id).toBeGreaterThanOrEqual(-0.01);
    expect(b.minY, id).toBeGreaterThanOrEqual(-0.01);
    expect(b.maxX, id).toBeLessThanOrEqual(doc.artboard.width + 0.01);
    expect(b.maxY, id).toBeLessThanOrEqual(doc.artboard.height + 0.01);
  }
  for (const node of Object.values(doc.nodes)) {
    if (node.type !== "frame" || !node.content) continue;
    const { assetId, ...c } = node.content;
    expect(clampContent(node, doc.assets[assetId]!, c), node.id).toEqual(c);
  }
}
const box = (doc: Doc, id: string) => worldBounds(doc, id)!;

describe("adaptToSize", () => {
  it("changes nothing but the format when the size is the same", () => {
    const doc = withPhoto(sized(docWith([photo("p", 540, 400, 600, 500), words("t", 540, 900, 800, 100, 60)]), POST));
    const next = adaptToSize(doc, { ...POST, format: "custom" });
    expect(next.nodes).toEqual(doc.nodes);
    expect(next.meta.format).toBe("custom");
  });

  it("post to story: the backdrop covers the new size, and layers keep their size and the edge they were near", () => {
    const doc = withPhoto(
      sized(docWith([photo("bg", 540, 540, 1080, 1080), words("title", 540, 120, 900, 120, 90), rect("logo", at(540, 540), 200, 200), words("footer", 540, 990, 800, 60, 30)]), POST),
    );
    const next = adaptToSize(doc, STORY);
    expect(next.artboard).toMatchObject({ width: 1080, height: 1920 });
    expect(next.nodes.bg).toMatchObject({ width: 1080, height: 1920, transform: { x: 540, y: 960 } });
    expect(next.nodes.title).toMatchObject({ size: 90, transform: { x: 540, y: 120 } });
    expect(next.nodes.footer).toMatchObject({ size: 30, transform: { y: 1830 } });
    expect(next.nodes.logo).toMatchObject({ width: 200, height: 200, transform: { y: 960 } });
    expectSound(next);
  });

  it("story to post scales everything to the tighter side, groups as a whole", () => {
    const doc = sized(
      docWith([words("title", 540, 200, 900, 140, 110), group("badge", at(540, 960), ["b1", "b2"], 400, 400), words("footer", 540, 1800, 900, 60, 32)], [rect("b1", at(-100, 0)), rect("b2", at(100, 0))]),
      STORY,
    );
    const next = adaptToSize(doc, POST);
    const k = 1080 / 1920;
    expect((next.nodes.title as TextNode).size).toBeCloseTo(110 * k, 1);
    expect(next.nodes.badge!.transform).toMatchObject({ scaleX: k, scaleY: k, y: 540 });
    // The group's children keep their places inside it.
    expect(next.nodes.b1).toEqual(doc.nodes.b1);
    expect(box(next, "title").maxY).toBeLessThan(box(next, "badge").minY);
    expect(box(next, "badge").maxY).toBeLessThan(box(next, "footer").minY);
    expectSound(next);
  });

  it("stretches edge-to-edge bands along their side, but keeps circles round", () => {
    const circle: ShapeNode = { ...rect("dot", at(540, 300), 300, 300), geometry: { kind: "ellipse" } };
    const doc = sized(docWith([rect("band", at(540, 540), 1080, 100), { ...circle, width: 1000 }]), POST);
    const next = adaptToSize(doc, THUMB);
    const s = 720 / 1080;
    expect(next.nodes.band).toMatchObject({ width: 1280, transform: { x: 640 } });
    expect(next.nodes.band!.height).toBeCloseTo(100 * s, 1);
    expect(next.nodes.dot!.width / next.nodes.dot!.height).toBeCloseTo(1000 / 300, 3);
    expectSound(next);
  });

  it("story to thumbnail: the main photo takes the left half and the words stack readably on the right", () => {
    const doc = withPhoto(
      sized(
        docWith([
          words("title", 540, 160, 900, 140, 110),
          photo("photo", 540, 800, 800, 1000),
          words("caption", 540, 1200, 600, 60, 30),
          words("body", 540, 1475, 800, 110, 34),
          rect("divider", at(540, 1572), 100, 4),
          words("details", 540, 1630, 900, 40, 26),
        ]),
        STORY,
      ),
    );
    const next = adaptToSize(doc, THUMB);
    const p = box(next, "photo");
    expect(p.maxX).toBeLessThanOrEqual(640);
    expect(p.maxY - p.minY).toBeGreaterThan(600);
    for (const id of ["title", "body", "divider", "details"]) expect(box(next, id).minX, id).toBeGreaterThanOrEqual(640);
    // The caption sat on the photo, so it stays on the photo.
    const c = box(next, "caption");
    expect(c.minX >= p.minX && c.maxX <= p.maxX && c.minY >= p.minY && c.maxY <= p.maxY).toBe(true);
    // Reading order is kept, and type is bigger than scaling the whole story down would make it.
    expect(box(next, "title").maxY).toBeLessThan(box(next, "body").minY);
    expect(box(next, "body").maxY).toBeLessThan(box(next, "details").minY);
    expect((next.nodes.title as TextNode).size).toBeGreaterThan(110 * (720 / 1920) * 1.5);
    expectSound(next);
  });

  it("thumbnail to story puts the photo on top and the words below", () => {
    const doc = withPhoto(sized(docWith([photo("photo", 320, 360, 560, 640), words("title", 960, 300, 560, 120, 72), words("sub", 960, 460, 560, 60, 32)]), THUMB));
    const next = adaptToSize(doc, STORY);
    expect(box(next, "photo").maxY).toBeLessThanOrEqual(960);
    for (const id of ["title", "sub"]) expect(box(next, id).minY, id).toBeGreaterThanOrEqual(960);
    expectSound(next);
  });

  it("keeps locks and layers it can't see, and doesn't touch the source", () => {
    const locked: Node = { ...rect("deco", at(540, 540), 300, 300), lock: "locked" };
    const doc = sized(docWith([locked]), POST);
    const before = structuredClone(doc);
    expect(adaptToSize(doc, STORY).nodes.deco!.lock).toBe("locked");
    expect(doc).toEqual(before);
  });
});

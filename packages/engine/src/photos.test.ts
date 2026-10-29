import type { AssetRef, FrameNode } from "@vash/schema";
import { describe, expect, it } from "vitest";
import { applyCommand } from "./commands";
import { checkPolicy } from "./policy";
import { clampContent, fillPhotos, frameAt, newPhotoFrame, photoTargets, placePhoto, removePhoto, zoomPhoto } from "./photos";
import { docWith, frame, rect } from "./test-docs";

const photo = (id: string, width = 400, height = 200): AssetRef => ({ id, kind: "photo", mime: "image/jpeg", width, height });

describe("asset command", () => {
  it("adds, replaces and removes a reference, and undoes each", () => {
    const doc = docWith([]);
    const added = applyCommand(doc, { type: "asset", id: "a", ref: photo("a") });
    expect(added.doc.assets.a).toEqual(photo("a"));
    expect(applyCommand(added.doc, added.inverse).doc.assets).toEqual({});
    const removed = applyCommand(added.doc, { type: "asset", id: "a", ref: null });
    expect(removed.doc.assets).toEqual({});
    expect(applyCommand(removed.doc, removed.inverse).doc.assets.a).toEqual(photo("a"));
  });

  it("is always allowed: the asset list isn't layout", () => {
    expect(checkPolicy(docWith([]), { type: "asset", id: "a", ref: photo("a") }, "design")).toEqual({ ok: true });
  });
});

describe("frameAt", () => {
  const doc = docWith([frame("under", { x: 200, y: 200 }, 300, 300), rect("cover", { x: 200, y: 200 }, 50, 50), frame("locked", { x: 700, y: 700 })]);
  doc.nodes.locked = { ...doc.nodes.locked!, lock: "locked" };

  it("finds the frame under the point, even beneath other layers", () => {
    expect(frameAt(doc, { x: 200, y: 200 })).toBe("under");
    expect(frameAt(doc, { x: 900, y: 100 })).toBeNull();
  });

  it("skips frames the template locked", () => {
    expect(frameAt(doc, { x: 700, y: 700 })).toBeNull();
  });
});

describe("photoTargets", () => {
  it("lists empty and placeholder frames top to bottom, then left to right", () => {
    const filled: FrameNode = { ...frame("filled", { x: 100, y: 900 }), placeholder: false, content: { assetId: "x", offsetX: 0, offsetY: 0, scale: 1 } };
    const doc = docWith([frame("right", { x: 800, y: 100 }), frame("left", { x: 100, y: 110 }), frame("low", { x: 500, y: 500 }), filled]);
    // "left" sits 10 px lower than "right" but within the same row, so it comes first.
    expect(photoTargets(doc)).toEqual(["left", "right", "low"]);
  });
});

describe("placePhoto", () => {
  it("fills the frame to cover it, records the asset, and is one undo step", () => {
    const doc = docWith([frame("f", { x: 500, y: 500 })]);
    const cmd = placePhoto(doc, "f", photo("p1"));
    const { doc: next, inverse } = applyCommand(doc, cmd);
    expect((next.nodes.f as FrameNode).content).toEqual({ assetId: "p1", offsetX: 0, offsetY: 0, scale: 1 });
    expect(next.assets.p1).toEqual(photo("p1"));
    const undone = applyCommand(next, inverse).doc;
    expect((undone.nodes.f as FrameNode).content).toBeNull();
    expect(undone.assets).toEqual({});
  });

  it("drops the old photo's reference once nothing uses it", () => {
    let doc = docWith([frame("f", {}), frame("g", {})]);
    doc = applyCommand(doc, placePhoto(doc, "f", photo("old"))).doc;
    doc = applyCommand(doc, placePhoto(doc, "g", photo("old"))).doc;
    doc = applyCommand(doc, placePhoto(doc, "f", photo("new"))).doc;
    expect(Object.keys(doc.assets).sort()).toEqual(["new", "old"]); // "g" still shows "old".
    doc = applyCommand(doc, removePhoto(doc, "g")).doc;
    expect(Object.keys(doc.assets)).toEqual(["new"]);
    expect((doc.nodes.g as FrameNode).content).toBeNull();
  });

  it("works on a frame whose layout the template locked", () => {
    const doc = docWith([{ ...frame("f", {}), lock: "content-only" }]);
    expect(checkPolicy(doc, placePhoto(doc, "f", photo("p")), "design")).toEqual({ ok: true });
  });
});

describe("zoomPhoto and clampContent", () => {
  // A 400×200 photo in a 100×100 frame: at scale 1 it covers at 200×100, so it can slide 50 px sideways.
  it("keeps the photo covering the frame", () => {
    expect(clampContent({ width: 100, height: 100 }, photo("p"), { offsetX: 80, offsetY: 30, scale: 1 })).toEqual({ offsetX: 50, offsetY: 0, scale: 1 });
    expect(clampContent({ width: 100, height: 100 }, photo("p"), { offsetX: -80, offsetY: 30, scale: 2 })).toEqual({ offsetX: -80, offsetY: 30, scale: 2 });
    expect(clampContent({ width: 100, height: 100 }, photo("p"), { offsetX: 0, offsetY: 0, scale: 0.5 }).scale).toBe(1);
  });

  it("pulls the photo back in when zooming out", () => {
    let doc = docWith([frame("f", {})]);
    doc = applyCommand(doc, placePhoto(doc, "f", photo("p"))).doc;
    doc = applyCommand(doc, zoomPhoto(doc, "f", { scale: 2, offsetX: -120, offsetY: 40 })!).doc;
    doc = applyCommand(doc, zoomPhoto(doc, "f", { scale: 1 })!).doc;
    expect((doc.nodes.f as FrameNode).content).toMatchObject({ scale: 1, offsetX: -50, offsetY: 0 });
  });

  it("does nothing for an empty frame", () => {
    expect(zoomPhoto(docWith([frame("f", {})]), "f", { scale: 2 })).toBeNull();
  });
});

describe("newPhotoFrame", () => {
  it("adds a frame in the photo's shape, centred, holding the photo", () => {
    const doc = docWith([]);
    const { command, id } = newPhotoFrame(doc, photo("p", 1600, 900));
    const next = applyCommand(doc, command).doc;
    const node = next.nodes[id] as FrameNode;
    expect(node.content?.assetId).toBe("p");
    expect(node.width / node.height).toBeCloseTo(1600 / 900, 2);
    expect(Math.max(node.width, node.height)).toBe(600);
    expect(node.transform).toMatchObject({ x: 500, y: 500 });
    expect(next.root.at(-1)).toBe(id);
    expect(next.assets.p).toEqual(photo("p", 1600, 900));
  });
});

describe("fillPhotos", () => {
  const layout = () => docWith([frame("b", { x: 700, y: 200 }), frame("a", { x: 200, y: 200 }), frame("c", { x: 200, y: 700 })]);
  const content = (doc: ReturnType<typeof layout>, id: string) => (doc.nodes[id] as FrameNode).content?.assetId ?? null;

  it("fills waiting frames in reading order, then adds frames for the rest, in one undo step", () => {
    const doc = layout();
    const { command, filled } = fillPhotos(doc, ["p1", "p2", "p3", "p4"].map((id) => photo(id)));
    const { doc: next, inverse } = applyCommand(doc, command);
    expect([content(next, "a"), content(next, "b"), content(next, "c")]).toEqual(["p1", "p2", "p3"]);
    expect(filled.slice(0, 3)).toEqual(["a", "b", "c"]);
    expect(content(next, filled[3]!)).toBe("p4");
    const undone = applyCommand(next, inverse).doc;
    expect(undone.nodes).toEqual(doc.nodes);
    expect(undone.assets).toEqual({});
  });

  it("puts the first photo where it was dropped, and one photo into the selected frame", () => {
    const doc = layout();
    const dropped = applyCommand(doc, fillPhotos(doc, [photo("p1"), photo("p2")], { target: "c" }).command).doc;
    expect([content(dropped, "c"), content(dropped, "a")]).toEqual(["p1", "p2"]);
    const picked = applyCommand(doc, fillPhotos(doc, [photo("p1")], { selected: ["b"] }).command).doc;
    expect([content(picked, "b"), content(picked, "a")]).toEqual(["p1", null]);
  });
});

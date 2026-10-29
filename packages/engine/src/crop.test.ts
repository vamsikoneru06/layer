import type { AssetRef, FrameNode, Node } from "@vash/schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyCommand } from "./commands";
import { EditorCore } from "./editor-core";
import { createInteraction, type PointerInput } from "./interaction";
import { photoExtent, placePhoto, swapPhotos } from "./photos";
import { docWith, frame, rect } from "./test-docs";

const photo = (id: string): AssetRef => ({ id, kind: "photo", mime: "image/jpeg", width: 400, height: 200 });

/** Two 100×100 frames with photos (a 400×200 photo covers at 200×100: 50 px of slack each side). */
function setup(nodes: Node[] = [frame("f", { x: 200, y: 200 }), frame("g", { x: 600, y: 200 }), rect("r", { x: 600, y: 600 })]) {
  let doc = docWith(nodes);
  doc = applyCommand(doc, placePhoto(doc, "f", photo("p1"))).doc;
  doc = applyCommand(doc, placePhoto(doc, "g", photo("p2"))).doc;
  const core = new EditorCore(doc);
  const ui = createInteraction(core);
  const p = (x: number, y: number): PointerInput => ({ x, y, button: 0, shift: false, alt: false });
  const drag = (from: [number, number], to: [number, number]) => {
    ui.pointerDown(p(...from));
    ui.pointerMove(p((from[0] + to[0]) / 2, (from[1] + to[1]) / 2));
    ui.pointerMove(p(...to));
    ui.pointerUp(p(...to));
  };
  const content = (id: string) => (core.doc.nodes[id] as FrameNode).content;
  return { core, ui, p, drag, content };
}

describe("crop mode", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("starts only on a frame with a photo, selects it, and ends on endCrop or when deselected", () => {
    const { core } = setup([frame("f", { x: 200, y: 200 }), frame("g", { x: 600, y: 200 }), frame("empty", { x: 600, y: 600 })]);
    expect(core.startCrop("empty")).toBe(false);
    expect(core.startCrop("f")).toBe(true);
    expect(core.getState()).toMatchObject({ cropping: "f", selection: ["f"] });
    core.select(["g"]);
    expect(core.getState().cropping).toBeNull();
    core.startCrop("f");
    core.endCrop();
    expect(core.getState().cropping).toBeNull();
  });

  it("dragging moves the photo inside the frame, clamped, as one undo step", () => {
    const { core, drag, content } = setup();
    core.startCrop("f");
    drag([200, 200], [230, 240]);
    expect(content("f")).toMatchObject({ offsetX: 30, offsetY: 0 });
    drag([200, 200], [400, 200]);
    expect(content("f")).toMatchObject({ offsetX: 50 });
    expect(core.doc.nodes.f!.transform).toMatchObject({ x: 200, y: 200 }); // The frame itself stays put.
    core.undo();
    expect(content("f")).toMatchObject({ offsetX: 30 });
    expect(core.getState().cropping).toBe("f");
  });

  it("dropping the photo on another frame swaps them", () => {
    const { core, drag, content } = setup();
    core.startCrop("f");
    drag([200, 200], [600, 200]);
    expect([content("f")?.assetId, content("g")?.assetId]).toEqual(["p2", "p1"]);
    expect(core.getState()).toMatchObject({ selection: ["g"], cropping: null });
    core.undo();
    expect([content("f")?.assetId, content("g")?.assetId]).toEqual(["p1", "p2"]);
  });

  it("a press outside the frame ends crop mode and works as usual", () => {
    const { core, ui, p } = setup();
    core.startCrop("f");
    ui.pointerDown(p(600, 600));
    ui.pointerUp(p(600, 600));
    expect(core.getState()).toMatchObject({ cropping: null, selection: ["r"] });
  });

  it("scrolling over the photo zooms it, one undo step per pause", () => {
    const { core, ui, content } = setup();
    core.startCrop("f");
    const before = core.getState().viewport;
    for (let i = 0; i < 3; i++) ui.wheel({ x: 200, y: 200, deltaX: 0, deltaY: -50, zoom: false });
    vi.advanceTimersByTime(500);
    expect(content("f")!.scale).toBeCloseTo(Math.exp(1.5), 5);
    expect(core.getState().viewport).toEqual(before); // The canvas didn't scroll.
    core.undo();
    expect(content("f")!.scale).toBe(1);
  });
});

describe("swapPhotos and photoExtent", () => {
  it("swaps with an empty frame too, re-centring the photo", () => {
    let doc = docWith([frame("a", {}), frame("b", { x: 300 })]);
    doc = applyCommand(doc, placePhoto(doc, "a", photo("p"))).doc;
    doc = { ...doc, nodes: { ...doc.nodes, a: { ...(doc.nodes.a as FrameNode), content: { assetId: "p", offsetX: 20, offsetY: 0, scale: 2 } } } };
    const next = applyCommand(doc, swapPhotos(doc, "a", "b")!).doc;
    expect((next.nodes.a as FrameNode).content).toBeNull();
    expect((next.nodes.b as FrameNode).content).toEqual({ assetId: "p", offsetX: 0, offsetY: 0, scale: 1 });
    expect(swapPhotos(doc, "a", "a")).toBeNull();
  });

  it("outlines the whole photo, including what the frame hides", () => {
    let doc = docWith([frame("f", { x: 500, y: 500 })]);
    doc = applyCommand(doc, placePhoto(doc, "f", photo("p"))).doc;
    expect(photoExtent(doc, "f")).toEqual([{ x: 400, y: 450 }, { x: 600, y: 450 }, { x: 600, y: 550 }, { x: 400, y: 550 }]);
  });
});

import { describe, expect, it } from "vitest";
import { handleAt, handlePositions, selectionFrame } from "./handles";
import { apply } from "./math";
import { docWith, rect } from "./test-docs";

const doc = docWith([rect("a", { x: 200, y: 200 }, 100, 50), rect("b", { x: 600, y: 400 }, 100, 100), rect("r", { x: 500, y: 500, rotation: 90 }, 200, 100)]);
const view = { zoom: 1, panX: 0, panY: 0 };

describe("selectionFrame", () => {
  it("uses the node's own oriented box for a single selection", () => {
    const f = selectionFrame(doc, ["r"])!;
    expect([f.width, f.height, f.rotation]).toEqual([200, 100, 90]);
    const topRight = apply(f.matrix, { x: 100, y: -50 });
    expect(topRight.x).toBeCloseTo(550);
    expect(topRight.y).toBeCloseTo(600);
  });

  it("bounds several layers with one axis-aligned box", () => {
    const f = selectionFrame(doc, ["a", "b"])!;
    // a spans x 150..250, y 175..225; b spans x 550..650, y 350..450.
    expect([f.width, f.height, f.rotation]).toEqual([500, 275, 0]);
    expect(apply(f.matrix, { x: 0, y: 0 })).toEqual({ x: 400, y: 312.5 });
  });

  it("is null for an empty selection", () => {
    expect(selectionFrame(doc, [])).toBeNull();
  });
});

describe("handles", () => {
  const f = selectionFrame(doc, ["a"])!; // 100×50 at (200, 200): x 150..250, y 175..225

  it("puts eight resize handles on the box and a rotate handle above it", () => {
    const h = handlePositions(f, view);
    expect(h.nw).toEqual({ x: 150, y: 175 });
    expect(h.e).toEqual({ x: 250, y: 200 });
    expect(h.se).toEqual({ x: 250, y: 225 });
    expect(h.rotate.x).toBeCloseTo(200);
    expect(h.rotate.y).toBeCloseTo(175 - 24);
  });

  it("finds the handle under a screen point, preferring corners, and none when layout is locked", () => {
    expect(handleAt(f, view, { x: 152, y: 177 })).toBe("nw");
    expect(handleAt(f, view, { x: 200, y: 151 })).toBe("rotate");
    expect(handleAt(f, view, { x: 200, y: 200 })).toBeNull();
    expect(handleAt(f, view, { x: 152, y: 177 }, { layoutLocked: true })).toBeNull();
  });

  it("keeps handles a constant screen size when zoomed out", () => {
    const zoomed = { zoom: 0.25, panX: 0, panY: 0 };
    // nw corner on screen is (37.5, 43.75); 5 px away still hits.
    expect(handleAt(f, zoomed, { x: 41, y: 47 })).toBe("nw");
  });
});

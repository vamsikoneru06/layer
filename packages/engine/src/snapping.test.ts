import { describe, expect, it } from "vitest";
import { createSnapper, DEFAULT_SNAP } from "./snapping";
import { docWith, rect } from "./test-docs";

// 1000×1000 artboard, one other 100×100 layer centred at (700, 300): edges x 650/750, y 250/350.
const doc = docWith([rect("other", { x: 700, y: 300 }), rect("moving", { x: 100, y: 100 })]);
const box = (minX: number, minY: number, size = 100) => ({ minX, minY, maxX: minX + size, maxY: minY + size });

describe("snapper", () => {
  const snapper = createSnapper(doc, new Set(["moving"]));

  it("snaps the nearest edge or centre within the threshold and reports a guide", () => {
    // Left edge at 647 is 3 px from the other layer's left edge (650).
    const r = snapper.snapBox(box(647, 800), 6);
    expect(r.dx).toBe(3);
    expect(r.dy).toBe(0);
    expect(r.guides).toContainEqual(expect.objectContaining({ axis: "x", at: 650 }));
  });

  it("snaps to the artboard centre and edges", () => {
    // Centre x 498 → 500.
    expect(snapper.snapBox(box(448, 800), 6).dx).toBe(2);
    // Right edge 1004 → 1000; bottom edge 996 → 1000.
    const r = snapper.snapBox(box(904, 896), 6);
    expect(r.dx).toBe(-4);
    expect(r.dy).toBe(4);
  });

  it("does nothing outside the threshold and ignores excluded layers", () => {
    expect(snapper.snapBox(box(620, 800), 6)).toMatchObject({ dx: 0, dy: 0, guides: [] });
    // The moving layer's own edges (50/150) are not targets.
    expect(snapper.snapBox(box(52, 400), 1).dx).toBe(0);
  });

  it("spans each guide across both the moving box and the target", () => {
    const r = snapper.snapBox(box(647, 800), 6);
    const g = r.guides.find((x) => x.axis === "x" && x.at === 650)!;
    expect(g.from).toBeLessThanOrEqual(250);
    expect(g.to).toBeGreaterThanOrEqual(900);
  });

  it("snaps a single coordinate for resize handles", () => {
    expect(snapper.snapValue("y", 352, 6)).toEqual({ value: 350, guide: expect.objectContaining({ axis: "y", at: 350 }) });
    expect(snapper.snapValue("y", 380, 6)).toEqual({ value: 380, guide: null });
  });
});

describe("snap options", () => {
  const objectsOff = { objects: false, guides: { x: [], y: [] } };

  it("ignores the artboard and other layers when objects are off", () => {
    const off = createSnapper(doc, new Set(["moving"]), objectsOff);
    // Left edge 3 px from the artboard's left edge (0), and the layer edge at 650 is 3 px away: neither snaps.
    expect(off.snapBox(box(3, 800), 6)).toEqual({ dx: 0, dy: 0, guides: [] });
    expect(off.snapBox(box(647, 800), 6)).toEqual({ dx: 0, dy: 0, guides: [] });
    // Centre 498 would snap to the artboard centre with objects on.
    expect(off.snapBox(box(448, 800), 6).dx).toBe(0);
    expect(off.snapValue("x", 3, 6)).toEqual({ value: 3, guide: null });
  });

  it("snaps to a guide within the threshold when objects are off, spanning the artboard", () => {
    const guided = createSnapper(doc, new Set(["moving"]), { objects: false, guides: { x: [123], y: [400] } });
    // Left edge 120 is 3 px from the x guide at 123; top edge 397 is 3 px from the y guide at 400.
    const r = guided.snapBox(box(120, 397), 6);
    expect(r.dx).toBe(3);
    expect(r.dy).toBe(3);
    expect(r.guides).toEqual([
      { axis: "x", at: 123, from: 0, to: 1000 },
      { axis: "y", at: 400, from: 0, to: 1000 },
    ]);
    expect(guided.snapValue("x", 122, 6)).toEqual({ value: 123, guide: { axis: "x", at: 123, from: 0, to: 1000 } });
    expect(guided.snapValue("y", 380, 6)).toEqual({ value: 380, guide: null });
  });

  it("keeps guides as targets alongside objects", () => {
    const both = createSnapper(doc, new Set(["moving"]), { objects: true, guides: { x: [123], y: [] } });
    expect(both.snapBox(box(120, 800), 6).dx).toBe(3);
    // The layer edge at 650 still snaps.
    expect(both.snapBox(box(647, 800), 6).dx).toBe(3);
  });

  it("returns no shift and no guides when there are no targets at all", () => {
    const none = createSnapper(doc, new Set(["moving"]), objectsOff);
    expect(none.snapBox(box(120, 120), 6)).toEqual({ dx: 0, dy: 0, guides: [] });
    expect(none.snapValue("y", 120, 6)).toEqual({ value: 120, guide: null });
  });

  it("uses object snapping by default", () => {
    expect(createSnapper(doc, new Set(["moving"]), DEFAULT_SNAP).snapBox(box(647, 800), 6).dx).toBe(3);
  });
});

import { describe, expect, it } from "vitest";
import { createSnapper } from "./snapping";
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

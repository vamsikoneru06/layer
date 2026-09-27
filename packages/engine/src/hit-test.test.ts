import { describe, expect, it } from "vitest";
import { hitTest, nodesInBox } from "./hit-test";
import { docWith, ellipse, frame, group, rect } from "./test-docs";

describe("hitTest", () => {
  const doc = docWith(
    [rect("bottom", { x: 200, y: 200 }, 300, 300), ellipse("circle", { x: 200, y: 200 }, 100, 100), group("g", { x: 700, y: 700, rotation: 45 }, ["inner"])],
    [rect("inner", {}, 100, 20)],
  );

  it("returns the topmost layer under the point", () => {
    expect(hitTest(doc, { x: 200, y: 200 })).toBe("circle");
    expect(hitTest(doc, { x: 100, y: 100 })).toBe("bottom");
    expect(hitTest(doc, { x: 900, y: 100 })).toBeNull();
  });

  it("tests ellipses exactly, not by their box", () => {
    // Inside the circle's bounding box but outside the circle: falls through to the rectangle.
    expect(hitTest(doc, { x: 160, y: 160 })).toBe("bottom");
  });

  it("maps the point through rotation, including a rotated group", () => {
    // "inner" is a 100×20 bar rotated 45° about (700, 700).
    expect(hitTest(doc, { x: 730, y: 730 })).toBe("inner");
    expect(hitTest(doc, { x: 740, y: 700 })).toBeNull();
  });

  it("ignores hidden layers and honours scale", () => {
    const scaled = docWith([rect("r", { x: 100, y: 100, scaleX: 2 }, 50, 50), { ...rect("hidden", { x: 100, y: 100 }), visible: false }]);
    expect(hitTest(scaled, { x: 145, y: 100 })).toBe("r");
    expect(hitTest(scaled, { x: 155, y: 100 })).toBeNull();
  });

  it("treats frames by their shape", () => {
    const f = { ...frame("f", { x: 100, y: 100 }), shape: { kind: "ellipse" as const } };
    expect(hitTest(docWith([f]), { x: 55, y: 55 })).toBeNull();
    expect(hitTest(docWith([f]), { x: 100, y: 100 })).toBe("f");
  });
});

describe("nodesInBox", () => {
  it("returns top-level layers whose bounds intersect a marquee", () => {
    const doc = docWith([rect("a", { x: 100, y: 100 }), rect("b", { x: 500, y: 500 }), group("g", { x: 900, y: 900 }, ["c"])], [rect("c", {})]);
    expect(nodesInBox(doc, { minX: 0, minY: 0, maxX: 120, maxY: 120 })).toEqual(["a"]);
    expect(nodesInBox(doc, { minX: 400, minY: 400, maxX: 1000, maxY: 1000 })).toEqual(["b", "g"]);
  });
});

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

  it("tests polygons by their outline, not their box", () => {
    // A triangle in a 100×100 box centred at (100, 100): apex at the top, base 25 px below the centre.
    const tri = { ...rect("tri", { x: 100, y: 100 }), geometry: { kind: "polygon" as const, sides: 3 } };
    expect(hitTest(docWith([tri]), { x: 100, y: 110 })).toBe("tri");
    expect(hitTest(docWith([tri]), { x: 60, y: 60 })).toBeNull(); // top-left corner of the box
    expect(hitTest(docWith([tri]), { x: 100, y: 140 })).toBeNull(); // below the base
  });

  it("tests SVG paths by their outline, curves and arcs included", () => {
    // A unit-box diamond and a unit-box circle drawn with two arcs, both 100×100 at (100, 100).
    const diamond = { ...rect("d", { x: 100, y: 100 }), geometry: { kind: "path" as const, d: "M0.5 0 L1 0.5 L0.5 1 L0 0.5 Z" } };
    expect(hitTest(docWith([diamond]), { x: 100, y: 100 })).toBe("d");
    expect(hitTest(docWith([diamond]), { x: 60, y: 60 })).toBeNull();
    const circle = { ...frame("c", { x: 100, y: 100 }), shape: { kind: "path" as const, d: "M0 0.5 A0.5 0.5 0 1 1 1 0.5 A0.5 0.5 0 1 1 0 0.5 Z" } };
    expect(hitTest(docWith([circle]), { x: 100, y: 145 })).toBe("c");
    expect(hitTest(docWith([circle]), { x: 57, y: 57 })).toBeNull();
    const blob = { ...rect("b", { x: 100, y: 100 }), geometry: { kind: "path" as const, d: "M0 1 C0 0 1 0 1 1 Z" } };
    expect(hitTest(docWith([blob]), { x: 100, y: 120 })).toBe("b");
    expect(hitTest(docWith([blob]), { x: 55, y: 55 })).toBeNull();
  });

  it("misses the cut-away corners of a rounded rectangle", () => {
    const r = { ...rect("r", { x: 100, y: 100 }), geometry: { kind: "rect" as const, cornerRadius: 40 } };
    expect(hitTest(docWith([r]), { x: 52, y: 52 })).toBeNull();
    expect(hitTest(docWith([r]), { x: 52, y: 100 })).toBe("r");
  });

  it("lets the pad reach a thin or pointed outline", () => {
    const tri = { ...rect("tri", { x: 100, y: 100 }), geometry: { kind: "polygon" as const, sides: 3 } };
    expect(hitTest(docWith([tri]), { x: 100, y: 128 }, 0)).toBeNull();
    expect(hitTest(docWith([tri]), { x: 100, y: 128 }, 4)).toBe("tri");
  });
});

describe("nodesInBox", () => {
  it("returns top-level layers whose bounds intersect a marquee", () => {
    const doc = docWith([rect("a", { x: 100, y: 100 }), rect("b", { x: 500, y: 500 }), group("g", { x: 900, y: 900 }, ["c"])], [rect("c", {})]);
    expect(nodesInBox(doc, { minX: 0, minY: 0, maxX: 120, maxY: 120 })).toEqual(["a"]);
    expect(nodesInBox(doc, { minX: 400, minY: 400, maxX: 1000, maxY: 1000 })).toEqual(["b", "g"]);
  });
});

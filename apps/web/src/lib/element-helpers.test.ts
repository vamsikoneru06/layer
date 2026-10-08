import { describe, expect, it } from "vitest";
import { filterByName, fitBox, polygonUnitPoints } from "./element-helpers";

describe("polygonUnitPoints", () => {
  it("gives one corner per side, all inside the unit box", () => {
    for (const sides of [3, 5, 6, 8]) {
      const points = polygonUnitPoints(sides);
      expect(points).toHaveLength(sides);
      for (const [x, y] of points) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(1);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(1);
      }
    }
  });

  it("puts the first corner at the top centre and goes clockwise", () => {
    const points = polygonUnitPoints(3);
    expect(points[0]?.[0]).toBeCloseTo(0.5);
    expect(points[0]?.[1]).toBeCloseTo(0);
    // Clockwise on screen from the top goes right and down: the second corner is right of centre and below it.
    expect(points[1]?.[0]).toBeGreaterThan(0.5);
    expect(points[1]?.[1]).toBeGreaterThan(0.5);
  });

  it("places every corner the same distance from the centre", () => {
    for (const sides of [3, 5, 6, 8]) {
      for (const [x, y] of polygonUnitPoints(sides)) {
        expect(Math.hypot(x - 0.5, y - 0.5)).toBeCloseTo(0.5);
      }
    }
  });
});

describe("fitBox", () => {
  it("scales the longer side to the size and keeps the proportions", () => {
    expect(fitBox(300, 150, 40)).toEqual({ width: 40, height: 20 });
    expect(fitBox(150, 300, 40)).toEqual({ width: 20, height: 40 });
  });

  it("keeps a square square", () => {
    expect(fitBox(300, 300, 40)).toEqual({ width: 40, height: 40 });
  });
});

describe("filterByName", () => {
  const items = [{ name: "Arrow right" }, { name: "Arrow up right" }, { name: "Heart" }];

  it("keeps everything for a blank query", () => {
    expect(filterByName(items, "")).toBe(items);
    expect(filterByName(items, "   ")).toBe(items);
  });

  it("matches part of a name, ignoring case and surrounding spaces", () => {
    expect(filterByName(items, "  ARROW ")).toEqual([{ name: "Arrow right" }, { name: "Arrow up right" }]);
    expect(filterByName(items, "heart")).toEqual([{ name: "Heart" }]);
  });

  it("returns nothing when no name matches", () => {
    expect(filterByName(items, "zzz")).toEqual([]);
  });
});

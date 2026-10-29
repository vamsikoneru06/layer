import { LIMITS, validatePathData } from "@vash/schema";
import { describe, expect, it } from "vitest";
import { LINES, SHAPES, type CatalogShape } from "./shape-catalog";

const ALL: readonly CatalogShape[] = [...SHAPES, ...LINES];

const pathsOf = (s: CatalogShape): string[] => (s.geometry.kind === "path" ? [s.geometry.d] : []);

describe("shape catalogue", () => {
  it("has unique ids across shapes and lines", () => {
    const ids = ALL.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every entry a name and a positive size", () => {
    for (const s of ALL) {
      expect(s.name.trim().length, s.id).toBeGreaterThan(0);
      expect(s.width, s.id).toBeGreaterThan(0);
      expect(s.height, s.id).toBeGreaterThan(0);
    }
  });

  it("validates every path with validatePathData", () => {
    for (const s of ALL) {
      for (const d of pathsOf(s)) {
        expect(validatePathData(d, LIMITS.pathChars), s.id).toEqual({ ok: true });
      }
    }
  });

  it("keeps every path number inside the 0 to 1 unit box", () => {
    for (const s of ALL) {
      for (const d of pathsOf(s)) {
        const numbers = d.match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g) ?? [];
        expect(numbers.length, s.id).toBeGreaterThan(0);
        for (const n of numbers) {
          const v = Number(n);
          expect(v >= 0 && v <= 1, `${s.id}: ${n}`).toBe(true);
        }
      }
    }
  });

  it("keeps polygons within the sides limits", () => {
    for (const s of ALL) {
      if (s.geometry.kind !== "polygon") continue;
      const { sides } = s.geometry;
      expect(Number.isInteger(sides), s.id).toBe(true);
      expect(sides, s.id).toBeGreaterThanOrEqual(LIMITS.polygonSidesMin);
      expect(sides, s.id).toBeLessThanOrEqual(LIMITS.polygonSidesMax);
    }
  });

  it("fills every shape and strokes none", () => {
    expect(SHAPES.length).toBeGreaterThan(0);
    for (const s of SHAPES) {
      expect(s.fill, s.id).toBe(true);
      expect(s.strokeWidth, s.id).toBeNull();
    }
  });

  it("leaves every line unfilled with a stroke", () => {
    expect(LINES.length).toBeGreaterThan(0);
    for (const s of LINES) {
      expect(s.fill, s.id).toBe(false);
      expect(typeof s.strokeWidth, s.id).toBe("number");
      expect(s.strokeWidth as number, s.id).toBeGreaterThan(0);
    }
  });
});

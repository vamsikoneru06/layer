import { describe, expect, it } from "vitest";
import { decompose, fromTransform, matricesClose, multiply } from "./math";

describe("decompose", () => {
  it("inverts fromTransform, including flips and negative rotation", () => {
    const cases = [
      { x: 10, y: 20, rotation: 30, scaleX: 2, scaleY: 3 },
      { x: -5, y: 7, rotation: -120, scaleX: 1, scaleY: -1 },
      { x: 0, y: 0, rotation: 0, scaleX: -1, scaleY: 1 },
    ];
    for (const t of cases) {
      const m = fromTransform(t);
      expect(matricesClose(fromTransform(decompose(m)), m)).toBe(true);
    }
  });

  it("keeps position, rotation and uniform scale readable", () => {
    const t = decompose(fromTransform({ x: 5, y: 6, rotation: 90, scaleX: 2, scaleY: 2 }));
    expect(t.x).toBeCloseTo(5);
    expect(t.y).toBeCloseTo(6);
    expect(t.rotation).toBeCloseTo(90);
    expect(t.scaleX).toBeCloseTo(2);
    expect(t.scaleY).toBeCloseTo(2);
  });

  it("reports shear as not representable (a rotated layer in a stretched group)", () => {
    const stretch = fromTransform({ x: 0, y: 0, rotation: 0, scaleX: 2, scaleY: 1 });
    const turned = fromTransform({ x: 0, y: 0, rotation: 45, scaleX: 1, scaleY: 1 });
    const m = multiply(stretch, turned);
    expect(matricesClose(fromTransform(decompose(m)), m)).toBe(false);
  });
});

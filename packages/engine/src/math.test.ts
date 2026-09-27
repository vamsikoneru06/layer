import { describe, expect, it } from "vitest";
import { aabb, apply, boxCorners, fromTransform, IDENTITY, invert, multiply, rotation, scaling, translation } from "./math";

const close = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  expect(a.x).toBeCloseTo(b.x, 9);
  expect(a.y).toBeCloseTo(b.y, 9);
};

describe("affine matrices", () => {
  it("applies translation, rotation (clockwise in y-down space) and scale", () => {
    close(apply(translation(10, 20), { x: 1, y: 2 }), { x: 11, y: 22 });
    close(apply(rotation(90), { x: 1, y: 0 }), { x: 0, y: 1 });
    close(apply(scaling(2, 3), { x: 1, y: 1 }), { x: 2, y: 3 });
  });

  it("multiplies right-to-left: multiply(a, b) applies b first", () => {
    const m = multiply(translation(100, 0), rotation(90));
    close(apply(m, { x: 1, y: 0 }), { x: 100, y: 1 });
  });

  it("inverts, and returns null for a singular matrix", () => {
    const m = fromTransform({ x: 40, y: -7, rotation: 33, scaleX: 2, scaleY: 0.5 });
    const inv = invert(m)!;
    close(apply(multiply(inv, m), { x: 3, y: 9 }), { x: 3, y: 9 });
    expect(invert(scaling(0, 1))).toBeNull();
  });

  it("builds T·R·S about the node centre from a transform", () => {
    const m = fromTransform({ x: 500, y: 300, rotation: 90, scaleX: 2, scaleY: 1 });
    // The local point (10, 0) is scaled to (20, 0), rotated to (0, 20), then moved to the centre.
    close(apply(m, { x: 10, y: 0 }), { x: 500, y: 320 });
    expect(fromTransform({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 })).toEqual(IDENTITY);
  });
});

describe("boxes", () => {
  it("returns the four corners of a centred box in world space", () => {
    const corners = boxCorners(100, 50, translation(10, 10));
    expect(corners.map((p) => [p.x, p.y])).toEqual([
      [-40, -15],
      [60, -15],
      [60, 35],
      [-40, 35],
    ]);
  });

  it("bounds rotated corners with an axis-aligned box", () => {
    const box = aabb(boxCorners(100, 100, rotation(45)));
    const half = Math.SQRT2 * 50;
    expect(box.minX).toBeCloseTo(-half);
    expect(box.maxX).toBeCloseTo(half);
    expect(box.minY).toBeCloseTo(-half);
    expect(box.maxY).toBeCloseTo(half);
  });
});

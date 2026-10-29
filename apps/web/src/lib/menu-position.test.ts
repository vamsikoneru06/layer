import { describe, expect, it } from "vitest";
import { clampMenuPosition } from "./menu-position";

const view = { width: 1000, height: 700 };
const size = { width: 220, height: 300 };

describe("clampMenuPosition", () => {
  it("leaves a menu that fits where it was opened", () => {
    expect(clampMenuPosition({ x: 100, y: 100 }, size, view)).toEqual({ x: 100, y: 100 });
  });

  it("moves a menu that would run off the right or bottom edge back on screen", () => {
    expect(clampMenuPosition({ x: 950, y: 650 }, size, view)).toEqual({ x: 1000 - 220 - 8, y: 700 - 300 - 8 });
  });

  it("keeps a margin from the top and left, and copes with a window smaller than the menu", () => {
    expect(clampMenuPosition({ x: -20, y: 2 }, size, view)).toEqual({ x: 8, y: 8 });
    expect(clampMenuPosition({ x: 50, y: 50 }, size, { width: 100, height: 100 })).toEqual({ x: 8, y: 8 });
  });
});

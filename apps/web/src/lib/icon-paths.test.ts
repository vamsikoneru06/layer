import { LIMITS, validatePathData } from "@vash/schema";
import { describe, expect, it } from "vitest";
import { ICONS } from "./icon-paths";
import { elementToPath, iconNodeToPathData, scalePathData } from "./svg-to-path";

describe("generated icons", () => {
  it("has unique ids and readable names", () => {
    const ids = ICONS.map((icon) => icon.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ICONS.length).toBeGreaterThanOrEqual(40);
    for (const icon of ICONS) expect(icon.name.trim().length).toBeGreaterThan(0);
  });

  it("has a path that passes the document path validator for every icon", () => {
    for (const icon of ICONS) {
      expect(validatePathData(icon.d, LIMITS.pathChars), icon.id).toEqual({ ok: true });
    }
  });
});

describe("svg-to-path conversion", () => {
  it("turns a circle into two half arcs in the unit box", () => {
    const d = iconNodeToPathData([["circle", { cx: "12", cy: "12", r: "10" }]]);
    expect(d).toBe("M 0.0833 0.5 A 0.4167 0.4167 0 1 0 0.9167 0.5 A 0.4167 0.4167 0 1 0 0.0833 0.5 Z");
    expect(validatePathData(d, LIMITS.pathChars)).toEqual({ ok: true });
  });

  it("scales relative arcs without touching the rotation or the flags", () => {
    expect(scalePathData("M 24 24 a 12 12 0 0 1 24 0", 1 / 24)).toBe("M 1 1 a 0.5 0.5 0 0 1 1 0");
  });

  it("keeps a rounded rect valid and clamps radii to half the box", () => {
    const d = elementToPath("rect", { x: "2", y: "2", width: "20", height: "20", rx: "4" });
    expect(d).toContain("A 4 4 0 0 1");
    const huge = iconNodeToPathData([["rect", { x: "0", y: "0", width: "24", height: "10", rx: "50" }]]);
    expect(validatePathData(huge, LIMITS.pathChars)).toEqual({ ok: true });
    expect(huge).toContain("A 0.5 0.2083 0 0 1");
  });
});

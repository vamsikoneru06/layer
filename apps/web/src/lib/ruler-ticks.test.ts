import { describe, expect, it } from "vitest";
import { rulerStep, rulerTicks } from "./ruler-ticks";

describe("ruler step", () => {
  it("picks 1, 2 or 5 times a power of ten so labels are at least the minimum apart", () => {
    expect(rulerStep(1, 60)).toBe(100);
    expect(rulerStep(4, 60)).toBe(20);
    expect(rulerStep(0.25, 60)).toBe(500);
    expect(rulerStep(8, 60)).toBe(10);
    expect(rulerStep(1, 30)).toBe(50);
    expect(rulerStep(1, 2)).toBe(2);
  });
});

describe("ruler ticks", () => {
  it("zoom 1: majors every 100 design px, minors at a fifth of a step", () => {
    const { major, minor } = rulerTicks({ start: 0, length: 1000, zoom: 1, pan: 0 });
    expect(major.map((t) => t.label)).toEqual(["0", "100", "200", "300", "400", "500", "600", "700", "800", "900", "1000"]);
    expect(major[1]).toEqual({ at: 100, screen: 100, label: "100" });
    // Minors every 20 px, skipping the majors: 51 indices from 0 to 50, minus the 11 multiples of 5.
    expect(minor).toHaveLength(40);
    expect(minor.slice(0, 4)).toEqual([20, 40, 60, 80]);
    expect(minor).not.toContain(100);
  });

  it("zoom 0.25: majors every 500 design px, which is 125 screen px apart", () => {
    const { major } = rulerTicks({ start: 0, length: 1000, zoom: 0.25, pan: 0 });
    expect(major).toHaveLength(9);
    expect(major[1]).toEqual({ at: 500, screen: 125, label: "500" });
    expect(major[8]!.screen).toBe(1000);
  });

  it("zoom 4: majors every 20 design px, and minors every 16 screen px", () => {
    const { major, minor } = rulerTicks({ start: 0, length: 400, zoom: 4, pan: 0 });
    expect(major.map((t) => t.screen)).toEqual([0, 80, 160, 240, 320, 400]);
    expect(minor[0]).toBe(16);
  });

  it("a negative pan shifts screen positions and keeps the first visible design unit", () => {
    const { major } = rulerTicks({ start: 0, length: 500, zoom: 1, pan: -250 });
    // Visible design span is 250..750.
    expect(major.map((t) => [t.at, t.screen])).toEqual([
      [300, 50],
      [400, 150],
      [500, 250],
      [600, 350],
      [700, 450],
    ]);
  });

  it("labels negative design values as integers", () => {
    const { major } = rulerTicks({ start: 0, length: 300, zoom: 1, pan: 350 });
    expect(major.map((t) => t.label)).toEqual(["-300", "-200", "-100"]);
    expect(major.map((t) => t.screen)).toEqual([50, 150, 250]);
  });

  it("uses the step of 2 with minors every 1 design px", () => {
    const { major, minor } = rulerTicks({ start: 0, length: 10, zoom: 1, pan: 0, minLabelPx: 2 });
    expect(major.map((t) => t.label)).toEqual(["0", "2", "4", "6", "8", "10"]);
    expect(minor).toEqual([1, 3, 5, 7, 9]);
  });

  it("keeps majors at least minLabelPx apart across zoom levels", () => {
    for (const zoom of [0.05, 0.1, 0.25, 0.5, 1, 2, 4, 8]) {
      const { major } = rulerTicks({ start: 0, length: 1200, zoom, pan: 17.5 });
      expect(major.length).toBeGreaterThan(1);
      for (let i = 1; i < major.length; i++) expect(major[i]!.screen - major[i - 1]!.screen).toBeGreaterThanOrEqual(60);
      for (const t of major) expect(t.label).toMatch(/^-?\d+$/);
    }
  });

  it("returns nothing for a degenerate view", () => {
    expect(rulerTicks({ start: 0, length: 0, zoom: 1, pan: 0 })).toEqual({ major: [], minor: [] });
    expect(rulerTicks({ start: 0, length: 100, zoom: 0, pan: 0 })).toEqual({ major: [], minor: [] });
    expect(rulerTicks({ start: 0, length: 100, zoom: Number.NaN, pan: 0 })).toEqual({ major: [], minor: [] });
  });
});

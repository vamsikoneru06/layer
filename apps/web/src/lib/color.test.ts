import { createEmptyDoc } from "@vash/schema";
import { describe, expect, it } from "vitest";
import { addStop, convertFill, docColors, fillCss, hsvToHex, parseHex, sortStops, toHsv } from "./color";

describe("parseHex", () => {
  it("reads 6 and 8 digit codes, with or without #", () => {
    expect(parseHex("#FF8000")).toEqual({ r: 255, g: 128, b: 0, a: 1 });
    expect(parseHex("ff800080")).toEqual({ r: 255, g: 128, b: 0, a: 128 / 255 });
    expect(parseHex(" #abc123 ")).toEqual({ r: 0xab, g: 0xc1, b: 0x23, a: 1 });
  });

  it("refuses anything else", () => {
    for (const bad of ["", "#FFF", "#GG0000", "#FF00000", "red"]) expect(parseHex(bad)).toBeNull();
  });
});

describe("hsv round trip", () => {
  it("returns the same code it was given", () => {
    for (const hex of ["#000000", "#FFFFFF", "#FF0000", "#00FF00", "#0000FF", "#1D1D1F", "#C08040", "#FF000080"]) {
      expect(hsvToHex(toHsv(hex)!)).toBe(hex);
    }
  });

  it("writes alpha only when the colour isn't opaque", () => {
    expect(hsvToHex({ h: 0, s: 1, v: 1, a: 1 })).toBe("#FF0000");
    expect(hsvToHex({ h: 120, s: 1, v: 1, a: 0 })).toBe("#00FF0000");
  });

  it("keeps hue for greys so the picker doesn't jump", () => {
    expect(toHsv("#808080", 200)!.h).toBe(200);
  });
});

describe("fillCss", () => {
  it("draws solids and gradients the way the canvas does", () => {
    expect(fillCss({ type: "solid", color: "#112233" })).toBe("#112233");
    expect(
      fillCss({ type: "linear", angle: 90, stops: [{ offset: 0, color: "#000000" }, { offset: 0.5, color: "#FFFFFF80" }] }),
    ).toBe("linear-gradient(90deg, #000000 0%, #FFFFFF80 50%)");
  });
});

describe("docColors", () => {
  it("lists each colour the design uses once, in order, ignoring case", () => {
    const doc = createEmptyDoc({ id: "d", kind: "design", title: "Test", format: "custom", size: { width: 100, height: 100 } });
    doc.artboard.background = { type: "solid", color: "#FFFFFF" };
    doc.nodes.t = { id: "t", type: "text", color: "#ff0000" } as never;
    doc.nodes.s = {
      id: "s",
      type: "shape",
      fill: { type: "linear", angle: 0, stops: [{ offset: 0, color: "#FF0000" }, { offset: 1, color: "#0000FF" }] },
      stroke: { color: "#00FF00", width: 1 },
    } as never;
    expect(docColors(doc)).toEqual(["#FFFFFF", "#FF0000", "#0000FF", "#00FF00"]);
  });
});

describe("fill editing", () => {
  it("converts between solid and linear, keeping the main colour", () => {
    const linear = convertFill({ type: "solid", color: "#FF0000" }, "linear");
    expect(linear).toEqual({ type: "linear", angle: 90, stops: [{ offset: 0, color: "#FF0000" }, { offset: 1, color: "#FFFFFF" }] });
    expect(convertFill(linear, "solid")).toEqual({ type: "solid", color: "#FF0000" });
    expect(convertFill({ type: "solid", color: "#ffffff" }, "linear")).toMatchObject({ stops: [{ color: "#ffffff" }, { color: "#1D1D1F" }] });
  });

  it("adds a stop in the widest gap", () => {
    const stops = [{ offset: 0, color: "#000000" }, { offset: 0.2, color: "#111111" }, { offset: 1, color: "#FFFFFF" }];
    expect(addStop(stops)).toEqual([...stops.slice(0, 2), { offset: 0.6, color: "#111111" }, stops[2]]);
  });

  it("sorts stops by offset", () => {
    expect(sortStops([{ offset: 1, color: "#000000" }, { offset: 0, color: "#FFFFFF" }]).map((s) => s.offset)).toEqual([0, 1]);
  });
});

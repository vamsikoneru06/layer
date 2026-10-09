import { describe, expect, it } from "vitest";
import { outlineColorFor } from "./text-effects-section";

describe("outlineColorFor", () => {
  it("uses a white outline behind dark text and a black one behind light text", () => {
    expect(outlineColorFor("#000000")).toBe("#FFFFFF");
    expect(outlineColorFor("#1D1D1F")).toBe("#FFFFFF");
    expect(outlineColorFor("#FFFFFF")).toBe("#000000");
    expect(outlineColorFor("#FFE066")).toBe("#000000");
  });

  it("ignores the alpha channel", () => {
    expect(outlineColorFor("#00000080")).toBe("#FFFFFF");
    expect(outlineColorFor("#FFFFFF80")).toBe("#000000");
  });
});

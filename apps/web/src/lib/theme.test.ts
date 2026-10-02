import { describe, expect, it } from "vitest";
import { themeAttribute } from "./theme";

describe("themeAttribute", () => {
  it("forces light or dark only for those exact values", () => {
    expect(themeAttribute("light")).toBe("light");
    expect(themeAttribute("dark")).toBe("dark");
  });

  it("follows the device for anything else", () => {
    for (const v of [undefined, "", "system", "DARK", "<script>"]) expect(themeAttribute(v)).toBeUndefined();
  });
});

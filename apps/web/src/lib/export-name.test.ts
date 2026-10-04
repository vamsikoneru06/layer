import { describe, expect, it } from "vitest";
import { exportFileName } from "./export-name";

describe("exportFileName", () => {
  it("slugs the title and marks the scale", () => {
    expect(exportFileName("Riya’s Birthday!", 1)).toBe("riyas-birthday.png");
    expect(exportFileName("Riya's Birthday!", 2)).toBe("riyas-birthday@2x.png");
  });

  it("falls back to 'design' when nothing is left of the title", () => {
    expect(exportFileName("🎉🎉", 3)).toBe("design@3x.png");
  });

  it("keeps names short without a trailing dash", () => {
    expect(exportFileName(`${"a".repeat(59)} b`, 1)).toBe(`${"a".repeat(59)}.png`);
  });
});

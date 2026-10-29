import { describe, expect, it } from "vitest";
import { fitNote } from "./text-fit";

describe("fitNote", () => {
  it("says nothing when the text fits at its size", () => {
    expect(fitNote({ fit: "none", size: 40 }, { overflow: false, size: 40 })).toBeNull();
    expect(fitNote({ fit: "shrink", size: 40 }, { overflow: false, size: 40 })).toBeNull();
  });

  it("warns when text without shrink doesn't fit, and points at the fix", () => {
    const note = fitNote({ fit: "none", size: 40 }, { overflow: true, size: 40 });
    expect(note?.tone).toBe("warn");
    expect(note?.text).toContain("Shrink text to fit");
  });

  it("warns when shrinking still isn't enough", () => {
    expect(fitNote({ fit: "shrink", size: 40 }, { overflow: true, size: 1 })?.tone).toBe("warn");
  });

  it("reports the size shrink-to-fit chose", () => {
    expect(fitNote({ fit: "shrink", size: 40 }, { overflow: false, size: 27.5 })).toEqual({ text: "Shrunk to 27 px to fit the box.", tone: "info" });
  });
});

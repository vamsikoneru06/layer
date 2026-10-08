import { LIMITS } from "@vash/schema";
import { describe, expect, it } from "vitest";
import { cleanAlt } from "./alt-text";

describe("cleanAlt", () => {
  it("trims and collapses whitespace", () => {
    expect(cleanAlt("  A dog   on \t grass  ")).toBe("A dog on grass");
  });

  it("turns line breaks into spaces", () => {
    expect(cleanAlt("Sunset\r\nover the hills\nseen from the road")).toBe("Sunset over the hills seen from the road");
  });

  it("removes other control characters", () => {
    expect(cleanAlt("a\u0007b\u0085c")).toBe("a b c");
  });

  it("returns an empty string for blank input", () => {
    expect(cleanAlt("")).toBe("");
    expect(cleanAlt(" \n\t ")).toBe("");
  });

  it("keeps at most the schema's length", () => {
    const out = cleanAlt("x".repeat(LIMITS.altChars + 50));
    expect(out).toHaveLength(LIMITS.altChars);
  });

  it("does not split a surrogate pair at the limit", () => {
    const out = cleanAlt("a".repeat(LIMITS.altChars - 1) + "\u{1F600}");
    expect(out).toBe("a".repeat(LIMITS.altChars - 1));
    expect(out.length).toBeLessThanOrEqual(LIMITS.altChars);
  });
});

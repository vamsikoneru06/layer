import { LIMITS } from "@vash/schema";
import { describe, expect, it } from "vitest";
import { normalizeTitle } from "./title";

describe("normalizeTitle", () => {
  it("trims the name", () => {
    expect(normalizeTitle("  Summer sale  ")).toEqual({ ok: true, title: "Summer sale" });
  });

  it("turns newlines and control characters into spaces (Review Focus 5)", () => {
    expect(normalizeTitle("Sale\nweek\t2")).toEqual({ ok: true, title: "Sale week 2" });
  });

  it("refuses an empty or whitespace-only name (Review Focus 5)", () => {
    expect(normalizeTitle("")).toEqual({ ok: false, reason: "Give your design a name." });
    expect(normalizeTitle(" \n\t ")).toEqual({ ok: false, reason: "Give your design a name." });
  });

  it("allows exactly the schema's limit and refuses one more (Review Focus 5)", () => {
    expect(normalizeTitle("a".repeat(LIMITS.titleChars)).ok).toBe(true);
    const over = normalizeTitle("a".repeat(LIMITS.titleChars + 1));
    expect(over).toEqual({ ok: false, reason: `Names can be up to ${LIMITS.titleChars} characters.` });
  });
});

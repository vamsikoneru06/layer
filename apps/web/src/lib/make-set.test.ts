import { LIMITS, createEmptyDoc, validateDoc } from "@vash/schema";
import { describe, expect, it } from "vitest";
import { templateDoc } from "../../tests/support/docs";
import { madeSizes, otherSizes, planSet, setTitle } from "./make-set";

describe("make the set", () => {
  it("offers every standard size except the design's own", () => {
    const post = createEmptyDoc({ id: crypto.randomUUID(), kind: "design", title: "Specials", format: "ig-post" });
    expect(otherSizes(post).map((s) => s.format)).toEqual(["ig-story", "yt-thumbnail", "poster", "invitation"]);
    const custom = createEmptyDoc({ id: crypto.randomUUID(), kind: "design", title: "Odd", format: "custom", size: { width: 1080, height: 1080 } });
    // A custom design that happens to be a post's size isn't offered as a post again.
    expect(otherSizes(custom).map((s) => s.format)).not.toContain("ig-post");
  });

  it("makes new, valid designs titled with their size, leaving the original alone", () => {
    const original = { ...templateDoc({ title: "Weekly specials" }), kind: "design" as const };
    const set = planSet(original, ["ig-story", "yt-thumbnail", "ig-post"]);
    expect(set.map((m) => m.format)).toEqual(["ig-story", "yt-thumbnail"]);
    expect(set.map((m) => m.doc.meta.title)).toEqual(["Weekly specials · Instagram story", "Weekly specials · YouTube thumbnail"]);
    for (const m of set) {
      expect(m.doc.id).not.toBe(original.id);
      expect(m.doc.kind).toBe("design");
      expect(validateDoc(m.doc, { kind: "design" }).ok).toBe(true);
    }
    expect(original.meta.title).toBe("Weekly specials");
  });

  it("keeps long titles within the limit", () => {
    const original = { ...templateDoc({ title: "x".repeat(120) }), kind: "design" as const };
    const [story] = planSet(original, ["ig-story"]);
    expect(story!.doc.meta.title).toHaveLength(120);
    expect(story!.doc.meta.title.endsWith(" · Instagram story")).toBe(true);
  });

  it("setTitle keeps a long base within the limit and ends with the size", () => {
    const title = setTitle("x".repeat(120), "Instagram story");
    expect(title).toHaveLength(LIMITS.titleChars);
    expect(title.endsWith(" · Instagram story")).toBe(true);
  });

  it("madeSizes returns the sizes whose titles already exist", () => {
    const original = { ...templateDoc({ title: "Weekly specials" }), kind: "design" as const };
    const titles = planSet(original, ["ig-story", "yt-thumbnail"]).map((m) => m.doc.meta.title);
    expect(madeSizes(original, [...titles, "Something else"])).toEqual(["ig-story", "yt-thumbnail"]);
    expect(madeSizes(original, [titles[0]!])).toEqual(["ig-story"]);
  });

  it("madeSizes returns nothing when no title matches", () => {
    const original = { ...templateDoc({ title: "Weekly specials" }), kind: "design" as const };
    expect(madeSizes(original, [])).toEqual([]);
    expect(madeSizes(original, ["Weekly specials", "Weekly specials · Instagram story x"])).toEqual([]);
  });
});

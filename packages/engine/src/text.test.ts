import { describe, expect, it } from "vitest";
import { layoutText, type Measure } from "./text";
import { text } from "./test-docs";

/** Every character is half the font size wide: easy arithmetic, fully deterministic. */
const measure: Measure = (s, _font, size) => s.length * size * 0.5;

// size 20 → 10 px per character; lineHeight 1.5 → 30 px lines.
const node = (content: string, o: Partial<ReturnType<typeof text>> = {}) => ({ ...text("t", {}, content, 100, 100), size: 20, lineHeight: 1.5, ...o });

describe("layoutText", () => {
  it("wraps greedily at spaces to the box width", () => {
    const l = layoutText(node("aaa bbb ccc ddd"), measure);
    expect(l.lines.map((x) => x.text)).toEqual(["aaa bbb", "ccc ddd"]);
    expect(l.lines[0]!.width).toBe(70);
    expect(l.lineHeight).toBe(30);
  });

  it("keeps explicit line breaks and breaks words longer than the box", () => {
    const l = layoutText(node("ab\nabcdefghijklmno"), measure);
    expect(l.lines.map((x) => x.text)).toEqual(["ab", "abcdefghij", "klmno"]);
  });

  it("aligns lines and centres the block vertically", () => {
    const centre = layoutText(node("aaa", { align: "center" }), measure);
    expect(centre.lines[0]!.x).toBe(35);
    expect(centre.lines[0]!.y).toBe(35); // (100 − 30) / 2
    expect(layoutText(node("aaa", { align: "right" }), measure).lines[0]!.x).toBe(70);
  });

  it("spreads justified lines to full width, except each paragraph's last line", () => {
    const l = layoutText(node("aa bb cc dd", { align: "justify" }), measure);
    expect(l.lines[0]).toMatchObject({ text: "aa bb cc", wordSpacing: 10 });
    expect(l.lines[1]).toMatchObject({ text: "dd", wordSpacing: 0 });
  });

  it("adds letter spacing per character", () => {
    const l = layoutText(node("abcd", { letterSpacing: 5 }), measure);
    expect(l.lines[0]!.width).toBe(60);
  });

  it("shrinks to fit by searching for the largest size that fits the box", () => {
    const long = node("aaaa bbbb cccc dddd eeee ffff", { fit: "shrink", size: 40 });
    const l = layoutText(long, measure);
    expect(l.size).toBeLessThan(40);
    expect(l.height).toBeLessThanOrEqual(100);
    expect(l.overflow).toBe(false);
    // A little bigger would not fit.
    expect(layoutText({ ...long, fit: "none", size: l.size + 1 }, measure).overflow).toBe(true);
  });

  it("reports overflow instead of shrinking when fit is none", () => {
    const l = layoutText(node("a b c d e f g h i j k l m n", { size: 40 }), measure);
    expect(l.size).toBe(40);
    expect(l.overflow).toBe(true);
  });

  it("caches by node identity", () => {
    const n = node("cached");
    expect(layoutText(n, measure)).toBe(layoutText(n, measure));
  });

  describe("text beyond plain ASCII", () => {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    const graphemes = (s: string) => [...segmenter.segment(s)].map((g) => g.segment);
    /** Like `measure`, but per visible character (grapheme), as a real font measures them. */
    const perGlyph: Measure = (s, _font, size) => graphemes(s).length * size * 0.5;
    const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

    /** A font where each code point has width, so half a cluster measures narrower than a whole one (as real fonts can). */
    const perCodePoint: Measure = (s, _font, size) => Array.from(s).length * size * 0.5;

    it("never splits an emoji when breaking a word wider than the box", () => {
      const coder = "🧑🏽‍💻"; // person + skin tone + joiner + laptop: one emoji, four code points
      const l = layoutText(node(coder.repeat(5)), perCodePoint);
      expect(l.lines.map((x) => x.text)).toEqual([coder.repeat(2), coder.repeat(2), coder]);
      for (const line of l.lines) expect(line.text).not.toMatch(LONE_SURROGATE);
      expect(layoutText(node("😀".repeat(15)), perGlyph).lines.map((x) => graphemes(x.text).length)).toEqual([10, 5]);
    });

    it("keeps Telugu and Devanagari letter clusters whole", () => {
      const ksha = "క్ష"; // ka + virama + ssa: one cluster, three code points
      expect(layoutText(node(ksha.repeat(7)), perCodePoint).lines.map((x) => x.text)).toEqual([ksha.repeat(3), ksha.repeat(3), ksha]);
      const kshaHindi = "क्ष";
      expect(layoutText(node(kshaHindi.repeat(4)), perCodePoint).lines.map((x) => x.text)).toEqual([kshaHindi.repeat(3), kshaHindi]);
    });

    it("adds letter spacing once per visible character", () => {
      expect(layoutText(node("😀😀", { letterSpacing: 5 }), perGlyph).lines[0]!.width).toBe(30);
      expect(layoutText(node("క్ష", { letterSpacing: 5 }), perGlyph).lines[0]!.width).toBe(15);
    });

    it("breaks a very long word with a few measurements per line, not one per character", () => {
      let calls = 0;
      const counting: Measure = (s, font, size) => (calls++, measure(s, font, size));
      const l = layoutText(node("x".repeat(400), { fit: "none" }), counting);
      expect(l.lines).toHaveLength(40);
      expect(calls).toBeLessThan(1_000);
    });
  });
});

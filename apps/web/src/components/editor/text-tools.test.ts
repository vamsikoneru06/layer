import { FONT_FAMILIES, LIMITS } from "@vash/schema";
import { describe, expect, it } from "vitest";
import { FONT_FACES } from "./font-faces";
import { changeCase, presetPatch, TEXT_PRESETS } from "./text-tools";

describe("changeCase", () => {
  it("upper, lower and title case", () => {
    expect(changeCase("Summer SALE now on", "upper")).toBe("SUMMER SALE NOW ON");
    expect(changeCase("Summer SALE now on", "lower")).toBe("summer sale now on");
    expect(changeCase("summer SALE (now on) twenty-five", "title")).toBe("Summer Sale (Now On) Twenty-Five");
  });

  it("keeps line breaks and non-Latin letters", () => {
    expect(changeCase("élan vital\nnew line", "title")).toBe("Élan Vital\nNew Line");
    expect(changeCase("నమస్తే hello", "upper")).toBe("నమస్తే HELLO");
  });
});

describe("TEXT_PRESETS", () => {
  it("only use fonts and faces the editor ships", () => {
    for (const p of TEXT_PRESETS) {
      expect(FONT_FAMILIES).toContain(p.family);
      expect(FONT_FACES[p.family]!.weights).toContain(p.weight);
      if (p.style === "italic") expect(FONT_FACES[p.family]!.italic).toBe(true);
    }
  });

  it("size to the design and stay within the limits", () => {
    for (const art of [{ width: 1080, height: 1920 }, { width: 16, height: 16 }, { width: 100_000, height: 100_000 }]) {
      for (const p of TEXT_PRESETS) {
        const { size } = presetPatch(p, art);
        expect(size).toBeGreaterThanOrEqual(LIMITS.fontSizeMin);
        expect(size).toBeLessThanOrEqual(LIMITS.fontSizeMax);
      }
    }
    expect(presetPatch(TEXT_PRESETS[1]!, { width: 1080, height: 1920 })).toEqual({ font: { family: "Poppins", weight: 700, style: "normal" }, size: 86, lineHeight: 1.1, letterSpacing: 0 });
  });
});

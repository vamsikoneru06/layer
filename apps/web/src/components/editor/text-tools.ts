import { LIMITS, type TextNode } from "@vash/schema";

export type Case = "upper" | "title" | "lower";

/** Rewrites text in a case. Title case capitalises the first letter of each word and lowers the rest. */
export function changeCase(text: string, to: Case): string {
  if (to === "upper") return text.toLocaleUpperCase();
  if (to === "lower") return text.toLocaleLowerCase();
  return text.toLocaleLowerCase().replace(/(^|[\s\-("'“‘])(\p{L})/gu, (_, gap: string, letter: string) => gap + letter.toLocaleUpperCase());
}

/** A one-click look for a text layer. Sizes are a share of the design's shorter side, like inserted text. */
export interface TextPreset {
  name: string;
  family: string;
  weight: number;
  style?: "normal" | "italic";
  size: number;
  lineHeight: number;
  letterSpacing: number;
}

export const TEXT_PRESETS: readonly TextPreset[] = [
  { name: "Title", family: "Archivo Black", weight: 400, size: 0.11, lineHeight: 1, letterSpacing: -1 },
  { name: "Heading", family: "Poppins", weight: 700, size: 0.08, lineHeight: 1.1, letterSpacing: 0 },
  { name: "Subhead", family: "Poppins", weight: 500, size: 0.05, lineHeight: 1.2, letterSpacing: 0 },
  { name: "Body", family: "Inter", weight: 400, size: 0.032, lineHeight: 1.45, letterSpacing: 0 },
  { name: "Caption", family: "Inter", weight: 600, size: 0.022, lineHeight: 1.3, letterSpacing: 2 },
  { name: "Quote", family: "Playfair Display", weight: 400, style: "italic", size: 0.05, lineHeight: 1.25, letterSpacing: 0 },
];

/** The fields a preset changes, sized for this design. */
export function presetPatch(p: TextPreset, artboard: { width: number; height: number }): Pick<TextNode, "font" | "size" | "lineHeight" | "letterSpacing"> {
  return {
    font: { family: p.family, weight: p.weight, style: p.style ?? "normal" },
    size: Math.min(LIMITS.fontSizeMax, Math.max(LIMITS.fontSizeMin, Math.round(Math.min(artboard.width, artboard.height) * p.size))),
    lineHeight: p.lineHeight,
    letterSpacing: p.letterSpacing,
  };
}

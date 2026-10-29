import { layoutText, type Measure, type TextLayout } from "@vash/engine";
import type { TextNode } from "@vash/schema";

let browser: Measure | null = null;

/**
 * Text widths from the browser's own font engine, the numbers the editor lays text out with. One
 * instance, so `layoutText` caches results across calls.
 */
export function browserMeasure(): Measure {
  if (!browser) {
    const ctx = document.createElement("canvas").getContext("2d");
    // Without a 2D context (rare), estimate half an em per character rather than failing the editor page.
    browser = ctx
      ? (text, font, size) => {
          ctx.font = `${font.style} ${font.weight} ${size}px "${font.family}", system-ui, sans-serif`;
          return ctx.measureText(text).width;
        }
      : (text, _font, size) => text.length * size * 0.5;
  }
  return browser;
}

/** The layout of a text layer in the browser, as the editor draws it. */
export function textLayout(node: TextNode): TextLayout {
  return layoutText(node, browserMeasure());
}

/**
 * What the text panel says about how the text sits in its box, or null when there is nothing to say.
 * `warn` means the text is cut off or spills out; `info` means shrink-to-fit made it smaller.
 */
export function fitNote(node: Pick<TextNode, "fit" | "size">, layout: Pick<TextLayout, "overflow" | "size">): { text: string; tone: "warn" | "info" } | null {
  if (layout.overflow) {
    return node.fit === "shrink"
      ? { text: "Even at its smallest size, the text doesn't fit this box. Make the box bigger or shorten the text.", tone: "warn" }
      : { text: "The text doesn't fit this box. Make the box bigger, shorten the text, or turn on Shrink text to fit.", tone: "warn" };
  }
  if (node.fit === "shrink" && layout.size < node.size - 0.5) {
    return { text: `Shrunk to ${Math.floor(layout.size)} px to fit the box.`, tone: "info" };
  }
  return null;
}

import { LIMITS } from "@vash/schema";

const isControl = (code: number) => code < 0x20 || (code >= 0x7f && code <= 0x9f);

/**
 * Tidies alt text before it is saved: line breaks and other control characters become spaces, runs of
 * whitespace collapse, the ends are trimmed and the schema's length limit applies. An empty result means
 * the layer has no alt text.
 */
export function cleanAlt(text: string): string {
  const flat = Array.from(text, (ch) => (isControl(ch.charCodeAt(0)) ? " " : ch))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  let out = flat.slice(0, LIMITS.altChars);
  // Do not leave half of a surrogate pair at the end.
  if (/[\uD800-\uDBFF]$/.test(out)) out = out.slice(0, -1);
  return out;
}

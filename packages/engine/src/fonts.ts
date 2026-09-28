import type { Doc } from "@vash/schema";

/**
 * CSS font shorthands for every distinct (family, weight, style) the document's text uses. Canvas
 * drawing doesn't make the browser download a web font, so the editor asks for these explicitly
 * (`document.fonts.load`) and re-measures text when they arrive.
 */
export function fontRequests(doc: Doc): string[] {
  const seen = new Set<string>();
  for (const node of Object.values(doc.nodes)) {
    if (node.type === "text") seen.add(`${node.font.style} ${node.font.weight} 16px "${node.font.family}"`);
  }
  return [...seen];
}
